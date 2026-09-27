/**
 * Abstração do provedor de IA. O AgentEngine fala somente com esta interface;
 * `AnthropicProvider` traduz para a Messages API e `MockAIProvider` é usado em dev/testes.
 */

export interface AITextBlock {
  type: 'text';
  text: string;
}

export interface AIImageBlock {
  type: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** base64 sem quebras de linha */
  data: string;
}

export interface AIToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  /** JSON serializado do resultado estruturado. */
  content: string;
  isError?: boolean;
}

export type AIUserBlock = AITextBlock | AIImageBlock | AIToolResultBlock;

export type AIMessage =
  | { role: 'user'; content: AIUserBlock[] }
  /** Texto de turnos anteriores (histórico persistido). */
  | { role: 'assistant'; content: string }
  /**
   * Conteúdo nativo do provedor produzido NESTA execução (inclui blocos de raciocínio e
   * tool_use), devolvido intacto na iteração seguinte e nunca persistido.
   */
  | { role: 'assistant'; raw: unknown };

export interface AISystemBlock {
  text: string;
  /** Marca o fim do prefixo estável (prompt caching). */
  cacheBreakpoint?: boolean;
}

export interface AIToolSpec {
  name: string;
  description: string;
  /** JSON Schema do input (type: object). */
  inputSchema: Record<string, unknown>;
}

export type AIEffort = 'low' | 'medium' | 'high';

export interface AIRequest {
  model: string;
  system: AISystemBlock[];
  messages: AIMessage[];
  tools: AIToolSpec[];
  maxOutputTokens: number;
  effort?: AIEffort;
  /** Identificador opaco para correlação em logs (nunca PII). */
  requestTag?: string;
}

export interface AIToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type AIStopReason =
  'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | 'other';

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AIResponse {
  /** Modelo que efetivamente respondeu (pode diferir em caso de fallback). */
  model: string;
  text: string;
  toolCalls: AIToolCall[];
  stopReason: AIStopReason;
  usage: AIUsage;
  rawAssistantContent: unknown;
}

export interface AIProvider {
  readonly name: 'anthropic' | 'mock';
  complete(request: AIRequest): Promise<AIResponse>;
}

export function emptyUsage(): AIUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(total: AIUsage, delta: AIUsage): AIUsage {
  return {
    inputTokens: total.inputTokens + delta.inputTokens,
    outputTokens: total.outputTokens + delta.outputTokens,
    cacheReadTokens: total.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + delta.cacheWriteTokens,
  };
}
