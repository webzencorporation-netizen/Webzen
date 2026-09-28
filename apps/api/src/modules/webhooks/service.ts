import { isUniqueConstraintError, systemDb, type Prisma } from '@botsaas/database';
import type { InboundMessage, NormalizedWebhookEvent, StatusUpdate } from '@botsaas/whatsapp';
import type { AppContainer } from '../../container';
import { recordError } from '../../lib/error-log';
import { systemScope } from '../../lib/scope';
import { ingestInboundMessage } from '../messaging/inbound';
import { applyStatusUpdate } from '../messaging/status';

export const WHATSAPP_PROVIDER_KEY = 'whatsapp';

export type RecordOutcome =
  | 'queued'
  | 'duplicate'
  | 'unknown_number'
  | 'unsupported'
  | 'without_phone';

/**
 * Etapa síncrona do webhook: identifica a empresa pelo phone_number_id, persiste o evento
 * com chave de deduplicação única e enfileira o processamento. Nada de IA aqui.
 */
export async function recordWebhookEvent(
  container: AppContainer,
  event: NormalizedWebhookEvent,
): Promise<RecordOutcome> {
  const account = event.phoneNumberId
    ? await systemDb.whatsAppAccount.findUnique({
        where: { phoneNumberId: event.phoneNumberId },
        select: { id: true, companyId: true },
      })
    : null;
  // Sem telefone não há contato: o evento fica retido (IGNORED + payload) para reprocessamento
  // quando houver identificação por BSUID, em vez de virar PROCESSED sem efeito.
  const ignored =
    !account || event.kind === 'unsupported' || event.kind === 'message_without_phone';

  let stored;
  try {
    stored = await systemDb.webhookEvent.create({
      data: {
        provider: WHATSAPP_PROVIDER_KEY,
        dedupeKey: event.dedupeKey,
        eventType: event.kind,
        companyId: account?.companyId ?? null,
        payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
        status: ignored ? 'IGNORED' : 'RECEIVED',
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await systemDb.webhookEvent.findUniqueOrThrow({
      where: {
        provider_dedupeKey: { provider: WHATSAPP_PROVIDER_KEY, dedupeKey: event.dedupeKey },
      },
    });
    // A gravação pode ter sido seguida de falha no Redis. O mesmo jobId preserva
    // a deduplicação na fila enquanto a reentrega recupera o evento sem job.
    if (
      existing.companyId &&
      (existing.status === 'RECEIVED' || existing.status === 'PROCESSING')
    ) {
      await container.queue.enqueue(
        'webhook.process',
        { webhookEventId: existing.id },
        { jobId: `wh-${existing.id}` },
      );
    }
    // FAILED segue os retries limitados do worker. Não reabre job esgotado e
    // retido no BullMQ; esse caso requer intervenção/replay explícito.
    return 'duplicate';
  }

  if (!account) {
    container.logger.warn(
      { phoneNumberId: event.phoneNumberId, kind: event.kind },
      'Webhook de número não cadastrado',
    );
    return 'unknown_number';
  }
  if (event.kind === 'unsupported') return 'unsupported';
  if (event.kind === 'message_without_phone') {
    container.logger.warn(
      { companyId: account.companyId, webhookEventId: stored.id, userId: event.userId },
      'Mensagem de WhatsApp sem telefone (somente BSUID) retida sem atendimento',
    );
    await recordError({
      source: 'WEBHOOK',
      code: 'whatsapp_message_without_phone',
      message:
        'Cliente com nome de usuário do WhatsApp enviou mensagem sem telefone; ela foi retida e não será respondida automaticamente.',
      companyId: account.companyId,
      context: { webhookEventId: stored.id, userId: event.userId ?? null },
    });
    return 'without_phone';
  }

  await systemDb.whatsAppAccount.update({
    where: { id: account.id },
    data: { lastWebhookAt: new Date() },
  });
  await container.queue.enqueue(
    'webhook.process',
    { webhookEventId: stored.id },
    { jobId: `wh-${stored.id}` },
  );
  return 'queued';
}

function reviveMessage(raw: InboundMessage): InboundMessage {
  return { ...raw, timestamp: new Date(raw.timestamp) };
}

function reviveStatus(raw: StatusUpdate): StatusUpdate {
  return { ...raw, timestamp: new Date(raw.timestamp) };
}

/** Etapa assíncrona (job `webhook.process`). Idempotente: eventos processados são ignorados. */
export async function processWebhookEvent(
  container: AppContainer,
  webhookEventId: string,
  attempt: { attemptsMade: number; maxAttempts: number; jobId?: string },
): Promise<void> {
  const event = await systemDb.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event || !event.companyId || event.status === 'PROCESSED' || event.status === 'IGNORED')
    return;

  await systemDb.webhookEvent.update({
    where: { id: event.id },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });
  const payload = event.payload as unknown as NormalizedWebhookEvent;
  const scope = systemScope(container, event.companyId, { type: 'CONTACT', label: 'WhatsApp' });

  try {
    if (payload.kind === 'message') {
      const account = await scope.db.whatsAppAccount.findUnique({
        where: { phoneNumberId: payload.phoneNumberId },
        select: { id: true },
      });
      await ingestInboundMessage(scope, {
        accountId: account?.id ?? null,
        contact: payload.contact,
        message: reviveMessage(payload.message),
      });
    } else if (payload.kind === 'status') {
      await applyStatusUpdate(scope, reviveStatus(payload.status));
    }
    await systemDb.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro';
    await systemDb.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
    if (attempt.attemptsMade + 1 >= attempt.maxAttempts) {
      await recordError({
        source: 'WEBHOOK',
        code: 'webhook_processing_failed',
        message,
        companyId: event.companyId,
        jobId: attempt.jobId,
      });
    }
    throw error;
  }
}
