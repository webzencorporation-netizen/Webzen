import type { z } from 'zod';

/** Resultado estruturado de uma tool — nunca texto livre inventado. */
export type ToolResult =
  | { ok: true; data: unknown; effects?: ToolEffects }
  | { ok: false; error: string; code?: string; effects?: ToolEffects };

/** Efeitos colaterais que o orquestrador precisa conhecer (ex.: handoff). */
export interface ToolEffects {
  handoff?: { reason: string };
}

export interface ToolExecutionMeta {
  /** Simulação (testar agente): tools de escrita não alteram dados reais. */
  dryRun: boolean;
}

export interface ToolDefinition<Ctx, Input = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  /** Ação que altera dados — exige confirmação do cliente antes (regra de prompt + parâmetro). */
  mutating: boolean;
  /** Autorização server-side (além da habilitação por empresa). */
  authorize?: (ctx: Ctx) => boolean | Promise<boolean>;
  handler: (input: Input, ctx: Ctx, meta: ToolExecutionMeta) => Promise<ToolResult>;
}

export interface ToolCallRecord {
  name: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
}
