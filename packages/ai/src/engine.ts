import {
  addUsage,
  emptyUsage,
  type AIEffort,
  type AIMessage,
  type AIProvider,
  type AISystemBlock,
  type AIUsage,
} from './provider/types';
import { ToolRegistry } from './tools/registry';
import type {
  ToolCallRecord,
  ToolDefinition,
  ToolEffects,
  ToolExecutionMeta,
  ToolResult,
} from './tools/types';

export type AgentOutcome =
  /** Resposta final gerada. */
  | 'answered'
  /** Encaminhado para humano por uma tool (texto pode estar vazio). */
  | 'handoff'
  /** O provedor recusou a solicitação (classificador de segurança). */
  | 'refused'
  /** Limite de iterações de tools estourado sem resposta final. */
  | 'max_iterations'
  /** Resposta cortada por max_tokens. */
  | 'truncated';

export interface AgentRunInput<Ctx> {
  provider: AIProvider;
  model: string;
  system: AISystemBlock[];
  /** Histórico + mensagem(ns) atuais do cliente (a última deve ser `user`). */
  messages: AIMessage[];
  tools: ToolDefinition<Ctx>[];
  toolContext: Ctx;
  maxIterations: number;
  maxOutputTokens: number;
  effort?: AIEffort;
  meta: ToolExecutionMeta;
  /** Timeout por tool (ms). */
  toolTimeoutMs?: number;
  onToolCall?: (record: ToolCallRecord & { input: unknown; result: ToolResult }) => void;
}

export interface AgentRunResult {
  outcome: AgentOutcome;
  text: string;
  usage: AIUsage;
  /** Modelos que responderam (em caso de fallback de recusa podem ser mais de um). */
  modelsUsed: string[];
  iterations: number;
  toolCalls: ToolCallRecord[];
  effects: ToolEffects;
  stopReason: string;
}

const DEFAULT_TOOL_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tool_timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Executa UMA tool com validação, autorização e captura de erro.
 * Erros viram `tool_result` com is_error — o modelo nunca recebe um resultado inventado.
 */
async function executeTool<Ctx>(
  tool: ToolDefinition<Ctx> | undefined,
  name: string,
  rawInput: unknown,
  ctx: Ctx,
  meta: ToolExecutionMeta,
  timeoutMs: number,
): Promise<ToolResult> {
  if (!tool)
    return { ok: false, code: 'unknown_tool', error: `Ferramenta "${name}" não está disponível.` };
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      error: `Parâmetros inválidos: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')}`,
    };
  }
  if (tool.authorize && !(await tool.authorize(ctx))) {
    return { ok: false, code: 'forbidden', error: 'Ação não permitida para esta empresa.' };
  }
  try {
    return await withTimeout(tool.handler(parsed.data, ctx, meta), timeoutMs);
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'tool_timeout'
        ? 'Tempo esgotado ao consultar o sistema.'
        : 'Falha interna ao executar a ação.';
    return {
      ok: false,
      code:
        error instanceof Error && error.message === 'tool_timeout' ? 'timeout' : 'internal_error',
      error: message,
    };
  }
}

export function serializeToolResult(result: ToolResult): string {
  return JSON.stringify(
    result.ok
      ? { ok: true, data: result.data }
      : { ok: false, error: result.error, code: result.code },
  );
}

/**
 * Loop do agente: chama o modelo, executa tools pedidas, devolve resultados e repete
 * até haver resposta final ou estourar o limite de iterações.
 * Não persiste nada — o orquestrador (backend) registra AgentRun, consumo e mensagens.
 */
export class AgentEngine {
  static async run<Ctx>(input: AgentRunInput<Ctx>): Promise<AgentRunResult> {
    const messages: AIMessage[] = [...input.messages];
    const toolSpecs = ToolRegistry.toSpecs(input.tools);
    const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
    const toolCalls: ToolCallRecord[] = [];
    const effects: ToolEffects = {};
    const modelsUsed = new Set<string>();
    let usage = emptyUsage();

    for (let iteration = 1; iteration <= input.maxIterations; iteration += 1) {
      const response = await input.provider.complete({
        model: input.model,
        system: input.system,
        messages,
        tools: toolSpecs,
        maxOutputTokens: input.maxOutputTokens,
        effort: input.effort,
      });
      usage = addUsage(usage, response.usage);
      modelsUsed.add(response.model);

      const base = {
        usage,
        modelsUsed: [...modelsUsed],
        iterations: iteration,
        toolCalls,
        effects,
        stopReason: response.stopReason,
      };

      if (response.stopReason === 'refusal') return { ...base, outcome: 'refused', text: '' };

      if (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
        messages.push({ role: 'assistant', raw: response.rawAssistantContent });
        // Tools independentes rodam em paralelo; todos os resultados voltam em UMA mensagem.
        const results = await Promise.all(
          response.toolCalls.map(async (call) => {
            const started = Date.now();
            const result = await executeTool(
              toolsByName.get(call.name),
              call.name,
              call.input,
              input.toolContext,
              input.meta,
              input.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
            );
            return { call, result, durationMs: Date.now() - started };
          }),
        );
        // Registros na ordem pedida pelo modelo (determinístico), não na ordem de conclusão.
        for (const { call, result, durationMs } of results) {
          const record: ToolCallRecord = {
            name: call.name,
            durationMs,
            ok: result.ok,
            ...(result.ok ? {} : { errorCode: result.code }),
          };
          toolCalls.push(record);
          if (result.effects?.handoff) effects.handoff = result.effects.handoff;
          input.onToolCall?.({ ...record, input: call.input, result });
        }
        messages.push({
          role: 'user',
          content: results.map(({ call, result }) => ({
            type: 'tool_result' as const,
            toolUseId: call.id,
            content: serializeToolResult(result),
            isError: !result.ok,
          })),
        });
        continue;
      }

      if (response.stopReason === 'max_tokens') {
        return { ...base, outcome: 'truncated', text: response.text };
      }
      return { ...base, outcome: effects.handoff ? 'handoff' : 'answered', text: response.text };
    }

    return {
      outcome: effects.handoff ? 'handoff' : 'max_iterations',
      text: '',
      usage,
      modelsUsed: [...modelsUsed],
      iterations: input.maxIterations,
      toolCalls,
      effects,
      stopReason: 'max_iterations',
    };
  }
}
