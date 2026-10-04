import { AIProviderError } from '@botsaas/shared';
import type {
  AIMessage,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStopReason,
  AIToolCall,
  AIUsage,
} from './types';

/**
 * Google Gemini pela API nativa (`generateContent`). Tem plano gratuito e aceita chamadas
 * de servidores fora do Brasil — a Meta Model API recusa as chamadas vindas da Railway
 * (404 "Model not found or access denied" em 100% dos testes de 2026-10-03).
 *
 * - autenticação pelo cabeçalho `x-goog-api-key`;
 * - tools em `functionDeclarations` com `parametersJsonSchema` (JSON Schema completo);
 * - o conteúdo do modelo (inclusive `thoughtSignature` do raciocínio) volta intacto na
 *   iteração seguinte do loop de tools, guardado em `rawAssistantContent`;
 * - o raciocínio conta em `maxOutputTokens`: somamos uma folga, como na Meta.
 */

export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_REASONING_HEADROOM = 2048;

export interface GeminiProviderConfig {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: GeminiFunctionCall;
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** O que guardamos em `rawAssistantContent`: o conteúdo original e o nome de cada chamada. */
interface GeminiRaw {
  content: GeminiContent;
  calls: { id: string; name: string }[];
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
}

function isGeminiRaw(value: unknown): value is GeminiRaw {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    'calls' in value &&
    Array.isArray((value as GeminiRaw).calls)
  );
}

function toResponseObject(content: string, isError: boolean | undefined): Record<string, unknown> {
  let parsed: unknown = content;
  try {
    parsed = JSON.parse(content);
  } catch {
    // resultado em texto puro
  }
  if (isError) return { error: parsed };
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { result: parsed };
}

/** Converte o histórico do agente para `contents`, juntando turnos seguidos do mesmo papel. */
export function toGeminiContents(messages: AIMessage[]): GeminiContent[] {
  const names = new Map<string, string>();
  const contents: GeminiContent[] = [];
  const push = (content: GeminiContent) => {
    const last = contents.at(-1);
    if (last && last.role === content.role) last.parts.push(...content.parts);
    else contents.push({ role: content.role, parts: [...content.parts] });
  };

  for (const message of messages) {
    if (message.role === 'assistant') {
      if ('raw' in message) {
        if (!isGeminiRaw(message.raw)) {
          throw new AIProviderError('Conteúdo de outro provedor no histórico do Gemini.', {
            retryable: false,
          });
        }
        for (const call of message.raw.calls) names.set(call.id, call.name);
        push(message.raw.content);
      } else if (message.content.trim()) {
        push({ role: 'model', parts: [{ text: message.content }] });
      }
      continue;
    }
    const parts: GeminiPart[] = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push({ text: block.text });
      else if (block.type === 'image') {
        parts.push({ inlineData: { mimeType: block.mediaType, data: block.data } });
      } else {
        const name = names.get(block.toolUseId);
        if (!name) {
          throw new AIProviderError('Resultado de ferramenta sem a chamada correspondente.', {
            retryable: false,
          });
        }
        parts.push({
          functionResponse: {
            id: block.toolUseId,
            name,
            response: toResponseObject(block.content, block.isError),
          },
        });
      }
    }
    if (parts.length > 0) push({ role: 'user', parts });
  }
  return contents;
}

function mapStopReason(finishReason: string | undefined, hasCalls: boolean): AIStopReason {
  if (hasCalls) return 'tool_use';
  switch (finishReason) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
    case 'RECITATION':
      return 'refusal';
    default:
      return 'other';
  }
}

function toUsage(metadata: GeminiResponse['usageMetadata']): AIUsage {
  const cached = metadata?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (metadata?.promptTokenCount ?? 0) - cached),
    outputTokens: (metadata?.candidatesTokenCount ?? 0) + (metadata?.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;

  constructor(private readonly config: GeminiProviderConfig) {}

  async complete(request: AIRequest): Promise<AIResponse> {
    const system = request.system.map((block) => block.text).join('\n\n');
    const body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: toGeminiContents(request.messages),
      ...(request.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.inputSchema,
                })),
              },
            ],
          }
        : {}),
      generationConfig: { maxOutputTokens: request.maxOutputTokens + GEMINI_REASONING_HEADROOM },
    };
    const url = `${this.config.baseURL ?? GEMINI_API_BASE_URL}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;

    let response: Response;
    try {
      response = await (this.config.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
      });
    } catch (error) {
      throw new AIProviderError('Falha de conexão com o Gemini.', { cause: error, retryable: true });
    }
    const payload = (await response.json().catch(() => null)) as GeminiResponse | null;
    if (!response.ok) {
      const detail = payload?.error?.message ?? `HTTP ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        throw new AIProviderError(`Credencial do Gemini inválida ou sem permissão: ${detail}`, {
          retryable: false,
        });
      }
      throw new AIProviderError(`Erro do Gemini (${response.status}): ${detail}`, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    const candidate = payload?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: AIToolCall[] = [];
    const calls: GeminiRaw['calls'] = [];
    parts.forEach((part, index) => {
      if (!part.functionCall) return;
      const id = part.functionCall.id ?? `call_${index}_${part.functionCall.name}`;
      // Guarda o id na própria parte: o resultado volta referenciando o mesmo id.
      part.functionCall.id = id;
      toolCalls.push({ id, name: part.functionCall.name, input: part.functionCall.args ?? {} });
      calls.push({ id, name: part.functionCall.name });
    });
    const text = parts
      .filter((part) => part.text && !part.thought)
      .map((part) => part.text)
      .join('');
    const usage = toUsage(payload?.usageMetadata);
    const blocked = payload?.promptFeedback?.blockReason;
    const stopReason = blocked ? 'refusal' : mapStopReason(candidate?.finishReason, toolCalls.length > 0);
    const model = payload?.modelVersion ?? request.model;
    const raw: GeminiRaw = { content: { role: 'model', parts }, calls };

    return {
      model,
      text,
      toolCalls,
      stopReason,
      usage,
      attempts: [{ model, served: true, fallback: false, usage }],
      ...(stopReason === 'refusal'
        ? {
            refusal: {
              category: blocked ?? candidate?.finishReason ?? null,
              explanation: null,
              recommendedModel: null,
            },
          }
        : {}),
      rawAssistantContent: raw,
    };
  }
}
