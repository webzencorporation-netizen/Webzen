import { isUniqueConstraintError, systemDb, type Prisma } from '@botsaas/database';
import type { InboundMessage, NormalizedWebhookEvent, StatusUpdate } from '@botsaas/whatsapp';
import type { AppContainer } from '../../container';
import { recordError } from '../../lib/error-log';
import { systemScope } from '../../lib/scope';
import { ingestInboundMessage } from '../messaging/inbound';
import { applyStatusUpdate } from '../messaging/status';

export const WHATSAPP_PROVIDER_KEY = 'whatsapp';

export type RecordOutcome = 'queued' | 'duplicate' | 'unknown_number' | 'unsupported';

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
  const ignored = !account || event.kind === 'unsupported';

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
    if (isUniqueConstraintError(error)) return 'duplicate';
    throw error;
  }

  if (!account) {
    container.logger.warn(
      { phoneNumberId: event.phoneNumberId, kind: event.kind },
      'Webhook de número não cadastrado',
    );
    return 'unknown_number';
  }
  if (event.kind === 'unsupported') return 'unsupported';

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
