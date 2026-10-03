import Anthropic from '@anthropic-ai/sdk';
import { mapProviderError, toAIResponse, toAnthropicMessages } from './anthropic';
import { AIProviderError } from '@botsaas/shared';
import type { AIEffort, AIProvider, AIRequest, AIResponse } from './types';

/**
 * Meta Model API (Muse Spark) pelo endpoint compatível com a Messages API da Anthropic.
 * Reaproveita a tradução de mensagens/respostas do `AnthropicProvider`, mas é um provider
 * separado: nada específico da Anthropic (fallback de recusa, `cache_control`) é enviado.
 *
 * Diferenças verificadas contra a API real (set/2026):
 * - autenticação `Authorization: Bearer` (aceita em /v1/messages e /v1/models; `x-api-key`
 *   é recusado em /v1/models);
 * - o raciocínio não pode ser desligado (`thinking: disabled` → 400) e seus tokens contam em
 *   `max_tokens` e em `output_tokens`; `output_config.effort` aceita low | medium | high;
 * - blocos `redacted_thinking` voltam na resposta e precisam ser reenviados intactos no loop
 *   de tools (o `raw` da interface já cobre isso);
 * - `tool_choice` só aceita `auto` (o padrão; nunca enviamos outro valor);
 * - `max_tokens` mínimo 16; modelo inexistente responde 404 — e a API também devolve esse
 *   404 ("Model not found or access denied") de forma intermitente para modelos válidos
 *   (out/2026: 2 de 12 chamadas da homologação; repetidas logo depois passaram);
 * - cache de prompt é automático (`cache_read_input_tokens`), sem marcação.
 */

export const META_MODEL_API_BASE_URL = 'https://api.meta.ai';

/**
 * Folga somada a `maxOutputTokens` para o raciocínio obrigatório. Medido: 300–450 tokens em
 * `low` e 600–700 em `medium` numa pergunta simples de atendimento. Sem a folga, o padrão de
 * 1024 tokens do agente cortaria respostas. Tokens não usados não são cobrados.
 */
export const META_REASONING_HEADROOM: Record<AIEffort, number> = {
  low: 2048,
  medium: 4096,
  high: 8192,
};

const META_MIN_MAX_TOKENS = 16;
/** Sem `effort` explícito a API raciocina bem mais que em `medium`; sempre enviamos um. */
const DEFAULT_EFFORT: AIEffort = 'medium';

export function metaMaxTokens(maxOutputTokens: number, effort: AIEffort = DEFAULT_EFFORT): number {
  return Math.max(META_MIN_MAX_TOKENS, maxOutputTokens + META_REASONING_HEADROOM[effort]);
}

export interface MetaModelProviderConfig {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  /** Retentativas do SDK (408/409/429/5xx/conexão). O job ainda tem seu próprio retry. */
  maxRetries?: number;
  /** Novas tentativas após o 404 intermitente (padrão 2), com espera crescente. */
  notFoundRetries?: number;
  /** Espera antes da 1ª nova tentativa após 404 (padrão 500 ms; triplica a cada vez). */
  notFoundRetryDelayMs?: number;
}

/** Cliente do SDK apontado para a Meta. `apiKey: null` impede o SDK de ler ANTHROPIC_API_KEY. */
export function createMetaClient(config: MetaModelProviderConfig): Anthropic {
  return new Anthropic({
    apiKey: null,
    authToken: config.apiKey,
    baseURL: config.baseURL ?? META_MODEL_API_BASE_URL,
    timeout: config.timeoutMs ?? 120_000,
    maxRetries: config.maxRetries ?? 2,
  });
}

export class MetaModelProvider implements AIProvider {
  readonly name = 'meta' as const;
  private readonly client: Anthropic;
  private readonly notFoundRetries: number;
  private readonly notFoundRetryDelayMs: number;

  constructor(config: MetaModelProviderConfig) {
    this.client = createMetaClient(config);
    this.notFoundRetries = config.notFoundRetries ?? 2;
    this.notFoundRetryDelayMs = config.notFoundRetryDelayMs ?? 500;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const effort = request.effort ?? DEFAULT_EFFORT;
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: metaMaxTokens(request.maxOutputTokens, effort),
      system: request.system.map((block) => ({ type: 'text' as const, text: block.text })),
      messages: toAnthropicMessages(request.messages),
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
      output_config: { effort },
    };

    for (let attempt = 0; ; attempt += 1) {
      try {
        return toAIResponse(await this.client.messages.create(params));
      } catch (error) {
        if (!(error instanceof Anthropic.NotFoundError)) throw mapProviderError(error, 'Meta');
        if (attempt < this.notFoundRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.notFoundRetryDelayMs * 3 ** attempt));
          continue;
        }
        // O modelo é validado na configuração; um 404 persistente é tratado como instabilidade
        // da Meta: o job tenta de novo mais tarde em vez de passar a conversa para a equipe.
        throw new AIProviderError(`Requisição rejeitada pela Meta: ${error.message}`, {
          cause: error,
          retryable: true,
        });
      }
    }
  }
}
