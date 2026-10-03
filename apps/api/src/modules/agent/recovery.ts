import { systemDb } from '@botsaas/database';
import type { AppContainer } from '../../container';
import { systemScope } from '../../lib/scope';
import { requestHandoff } from '../messaging/handoff';
import { scheduleAgentReply } from '../messaging/schedule';

/**
 * Recuperação de respostas travadas. Falhas da IA já têm fallback no runner (última tentativa
 * aplica o comportamento configurado e marca as entradas). O que fica sem resposta é trabalho
 * PERDIDO: worker que caiu, Redis fora na hora do enqueue, webhook que esgotou tentativas.
 *
 * A cada ciclo, conversas em modo IA com mensagem do cliente pendente há mais de
 * `STALE_AFTER_MS` (e há menos de `RECOVERY_WINDOW_MS`) recebem um novo `agent.reply`. O runner
 * relê tudo no banco e marca as entradas, então reagendar é idempotente.
 *
 * Limite: se já houve `MAX_RUNS_BEFORE_HANDOFF` execuções desde a mensagem pendente mais antiga
 * e ela continua sem tratamento, a falha é persistente (e pode estar cobrando IA a cada ciclo):
 * a conversa vai para atendimento humano, o que também a tira dos próximos ciclos.
 */

/** Acima do buffer (máx. 30 s) e dos retries do `agent.reply` (3 tentativas, backoff de 5 s). */
export const STALE_AFTER_MS = 10 * 60_000;
export const RECOVERY_WINDOW_MS = 6 * 3600_000;
export const MAX_RUNS_BEFORE_HANDOFF = 3;
/** Execução em andamento há menos que isso: deixa o runner atual terminar. */
const RUNNING_GRACE_MS = 5 * 60_000;
const BATCH_SIZE = 500;

export interface RecoveryResult {
  rescheduled: number;
  handedOff: number;
}

export async function recoverStalledReplies(
  container: AppContainer,
  now: Date = new Date(),
): Promise<RecoveryResult> {
  const pending = await systemDb.message.findMany({
    where: {
      direction: 'INBOUND',
      sender: 'CONTACT',
      agentHandledAt: null,
      createdAt: {
        gte: new Date(now.getTime() - RECOVERY_WINDOW_MS),
        lt: new Date(now.getTime() - STALE_AFTER_MS),
      },
      conversation: {
        mode: 'AI',
        channel: 'WHATSAPP',
        status: { not: 'CLOSED' },
        company: {
          status: { notIn: ['SUSPENDED', 'CANCELLED'] },
          aiConfiguration: { enabled: true },
        },
      },
    },
    select: { companyId: true, conversationId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  // Mensagem pendente mais antiga por conversa (a lista já vem em ordem crescente).
  const oldest = new Map<string, { companyId: string; since: Date }>();
  for (const message of pending) {
    if (!oldest.has(message.conversationId))
      oldest.set(message.conversationId, {
        companyId: message.companyId,
        since: message.createdAt,
      });
  }

  const result: RecoveryResult = { rescheduled: 0, handedOff: 0 };
  for (const [conversationId, { companyId, since }] of oldest) {
    const log = container.logger.child({ companyId, conversationId });
    try {
      const runs = await systemDb.agentRun.findMany({
        where: { conversationId, trigger: 'INBOUND_MESSAGE', startedAt: { gte: since } },
        select: { status: true, startedAt: true },
      });
      const running = runs.some(
        (run) =>
          run.status === 'RUNNING' && now.getTime() - run.startedAt.getTime() < RUNNING_GRACE_MS,
      );
      if (running) continue;

      const scope = systemScope(container, companyId, { type: 'SYSTEM', label: 'Recuperação' });
      const finished = runs.filter((run) => run.status === 'SUCCEEDED' || run.status === 'FAILED');
      if (finished.length >= MAX_RUNS_BEFORE_HANDOFF) {
        await requestHandoff(scope, conversationId, {
          requestedBy: 'SYSTEM',
          reason: `A IA não conseguiu concluir a resposta após ${finished.length} tentativas; mensagem do cliente aguardando desde ${since.toISOString()}.`,
        });
        result.handedOff += 1;
        log.warn(
          { runs: finished.length, since },
          'Resposta travada: conversa passada para humano',
        );
        continue;
      }

      if (await scheduleAgentReply(scope, conversationId, 0)) {
        result.rescheduled += 1;
        log.info({ since, runs: finished.length }, 'Resposta travada reagendada');
      }
    } catch (error) {
      // Uma conversa com problema não impede as demais; o próximo ciclo tenta de novo.
      log.error({ err: error }, 'Falha ao recuperar resposta travada');
    }
  }
  if (pending.length === BATCH_SIZE)
    container.logger.warn({ batch: BATCH_SIZE }, 'Recuperação atingiu o lote máximo');
  return result;
}
