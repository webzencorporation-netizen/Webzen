/**
 * Agrupamento de mensagens (debounce). Clientes costumam mandar várias mensagens curtas
 * seguidas ("oi" / "queria saber" / "quanto custa" / "limpeza de pele?"). Esperamos um
 * silêncio de `bufferSeconds` após a ÚLTIMA mensagem e chamamos o agente UMA vez.
 *
 * `maxWaitSeconds` evita espera infinita quando o cliente não para de digitar.
 */
export interface BufferDecisionInput {
  pending: { createdAt: Date }[];
  bufferSeconds: number;
  now: Date;
  maxWaitSeconds?: number;
}

export type BufferDecision =
  { action: 'none' } | { action: 'wait'; delayMs: number } | { action: 'process' };

export const MIN_BUFFER_SECONDS = 0;
export const MAX_BUFFER_SECONDS = 30;

export function clampBufferSeconds(value: number): number {
  return Math.min(MAX_BUFFER_SECONDS, Math.max(MIN_BUFFER_SECONDS, Math.round(value)));
}

export function decideBufferAction({
  pending,
  bufferSeconds,
  now,
  maxWaitSeconds,
}: BufferDecisionInput): BufferDecision {
  if (pending.length === 0) return { action: 'none' };
  const buffer = clampBufferSeconds(bufferSeconds) * 1000;
  const maxWait = (maxWaitSeconds ?? Math.max(20, bufferSeconds * 4)) * 1000;
  const times = pending.map((message) => message.createdAt.getTime());
  const newest = Math.max(...times);
  const oldest = Math.min(...times);
  const quietFor = now.getTime() - newest;
  if (quietFor >= buffer) return { action: 'process' };
  if (now.getTime() - oldest >= maxWait) return { action: 'process' };
  return { action: 'wait', delayMs: buffer - quietFor };
}
