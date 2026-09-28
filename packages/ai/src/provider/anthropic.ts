import Anthropic from '@anthropic-ai/sdk';
import { AIProviderError } from '@botsaas/shared';
import type {
  AIAttempt,
  AIMessage,
  AIProvider,
  AIRefusal,
  AIRequest,
  AIResponse,
  AIStopReason,
  AIToolCall,
  AIUsage,
  AIUserBlock,
} from './types';

export interface AnthropicProviderConfig {
  apiKey: string;
  timeoutMs?: number;
  /** Retentativas do SDK (408/409/429/5xx/conexão). O job ainda tem seu próprio retry. */
  maxRetries?: number;
  /**
   * Reexecução server-side quando o classificador de segurança recusa a requisição
   * (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Aplicado só aos modelos que suportam.
   */
  refusalFallback?: boolean;
  baseURL?: string;
}

const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const REFUSAL_FALLBACK_MODELS = new Set([
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-fable-5',
  'claude-fable-5-1',
]);

/** `output_config.effort` não é aceito por Haiku 4.5 / Sonnet 4.5 e anteriores. */
export function modelSupportsEffort(model: string): boolean {
  if (/haiku/.test(model)) return false;
  if (/claude-(sonnet|opus)-4-5/.test(model)) return false;
  if (/claude-(3|sonnet-4-0|opus-4-0|opus-4-1|sonnet-4-20|opus-4-20)/.test(model)) return false;
  return true;
}

function toUserContent(blocks: AIUserBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map((block): Anthropic.ContentBlockParam => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'image':
        return {
          type: 'image',
          source: { type: 'base64', media_type: block.mediaType, data: block.data },
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(block.isError ? { is_error: true } : {}),
        };
    }
  });
}

export function toAnthropicMessages(messages: AIMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === 'user') return { role: 'user', content: toUserContent(message.content) };
    if ('raw' in message)
      return { role: 'assistant', content: message.raw as Anthropic.ContentBlockParam[] };
    return { role: 'assistant', content: message.content };
  });
}

function mapStopReason(reason: string | null): AIStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    case 'pause_turn':
      return 'pause_turn';
    default:
      return 'other';
  }
}

function mapError(error: unknown): AIProviderError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AIProviderError('Credencial da Anthropic inválida ou sem permissão.', {
      cause: error,
      retryable: false,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AIProviderError('Limite de requisições da Anthropic atingido.', {
      cause: error,
      retryable: true,
    });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AIProviderError(`Requisição rejeitada pela Anthropic: ${error.message}`, {
      cause: error,
      retryable: false,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIProviderError('Falha de conexão com a Anthropic.', {
      cause: error,
      retryable: true,
    });
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return new AIProviderError(`Erro da Anthropic (${status}).`, {
      cause: error,
      retryable: status >= 500 || status === 429,
    });
  }
  return new AIProviderError('Falha inesperada no provedor de IA.', {
    cause: error,
    retryable: true,
  });
}

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): AIUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * `usage.iterations` (beta) registra cada tentativa: `message` para o modelo que recusou,
 * `fallback_message` para o que atendeu, sempre por último. O `usage` de topo cobre
 * somente a tentativa atendida; tokens de modelos diferentes nunca são somados.
 */
function toAttempts(response: Anthropic.Message | Anthropic.Beta.BetaMessage): AIAttempt[] {
  const usage = toUsage(response.usage);
  const iterations = 'iterations' in response.usage ? response.usage.iterations : null;
  if (!iterations?.length) {
    return [{ model: response.model, served: true, fallback: false, usage }];
  }
  return iterations.map((entry, index) => ({
    model: ('model' in entry ? entry.model : null) ?? response.model,
    served: index === iterations.length - 1,
    fallback: entry.type === 'fallback_message',
    usage: toUsage(entry),
  }));
}

function toRefusal(
  response: Anthropic.Message | Anthropic.Beta.BetaMessage,
): AIRefusal | undefined {
  if (response.stop_reason !== 'refusal') return undefined;
  const details = response.stop_details;
  return {
    category: details?.category ?? null,
    explanation: details?.explanation ?? null,
    recommendedModel:
      details && 'recommended_model' in details ? (details.recommended_model ?? null) : null,
  };
}

function toAIResponse(response: Anthropic.Message | Anthropic.Beta.BetaMessage): AIResponse {
  const toolCalls: AIToolCall[] = [];
  const texts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') texts.push(block.text);
    if (block.type === 'tool_use')
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
  }
  const refusal = toRefusal(response);
  return {
    model: response.model,
    text: texts.join('\n').trim(),
    toolCalls,
    stopReason: mapStopReason(response.stop_reason),
    usage: toUsage(response.usage),
    attempts: toAttempts(response),
    ...(refusal ? { refusal } : {}),
    // Devolvido intacto na próxima iteração: o bloco `fallback` deve manter sua posição.
    rawAssistantContent: response.content,
  };
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 120_000,
      maxRetries: config.maxRetries ?? 2,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const system: Anthropic.TextBlockParam[] = request.system.map((block) => ({
      type: 'text',
      text: block.text,
      ...(block.cacheBreakpoint ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
    const tools: Anthropic.Tool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system,
      messages: toAnthropicMessages(request.messages),
      ...(tools.length > 0 ? { tools } : {}),
      ...(request.effort && modelSupportsEffort(request.model)
        ? { output_config: { effort: request.effort } }
        : {}),
    };

    let response: Anthropic.Message | Anthropic.Beta.BetaMessage;
    try {
      response =
        this.config.refusalFallback && REFUSAL_FALLBACK_MODELS.has(request.model)
          ? await this.client.beta.messages.create({
              ...params,
              betas: [REFUSAL_FALLBACK_BETA],
              // O modelo alternativo é escolhido pela Anthropic conforme a categoria da recusa.
              fallbacks: 'default',
            })
          : await this.client.messages.create(params);
    } catch (error) {
      throw mapError(error);
    }
    return toAIResponse(response);
  }
}
