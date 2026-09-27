import type { MessageStatus } from '@botsaas/database';
import type { StatusUpdate } from '@botsaas/whatsapp';
import { WHATSAPP_ERROR_HINTS } from '@botsaas/whatsapp';
import type { CompanyScope } from '../../context';
import { notify } from '../../lib/notifications';

const ORDER: Record<MessageStatus, number> = {
  RECEIVED: 0,
  QUEUED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

const MAP: Record<StatusUpdate['status'], MessageStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Aplica atualização de status (enviado/entregue/lido/falhou) de forma monotônica. */
export async function applyStatusUpdate(
  scope: CompanyScope,
  update: StatusUpdate,
): Promise<'updated' | 'ignored' | 'not_found'> {
  const message = await scope.db.message.findFirst({ where: { externalId: update.externalId } });
  if (!message) return 'not_found';
  const next = MAP[update.status];
  // Status chegam fora de ordem: nunca regredimos (ex.: "delivered" depois de "read").
  if (next !== 'FAILED' && ORDER[next] <= ORDER[message.status]) return 'ignored';
  if (message.status === 'FAILED' && next !== 'FAILED') return 'ignored';

  const error = update.errors?.[0];
  await scope.db.message.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === 'SENT' ? { sentAt: update.timestamp } : {}),
      ...(next === 'DELIVERED' ? { deliveredAt: update.timestamp } : {}),
      ...(next === 'READ' ? { readAt: update.timestamp } : {}),
      ...(next === 'FAILED'
        ? {
            failedAt: update.timestamp,
            errorCode: error?.code !== undefined ? String(error.code) : 'unknown',
            errorMessage:
              (error?.code !== undefined ? WHATSAPP_ERROR_HINTS[error.code] : undefined) ??
              error?.details ??
              error?.message ??
              error?.title ??
              'Falha na entrega',
          }
        : {}),
    },
  });
  if (next === 'FAILED') {
    await scope.db.conversation.update({
      where: { id: message.conversationId },
      data: { needsAttention: true, attentionReason: 'Falha ao entregar mensagem' },
    });
    await notify(scope, {
      type: 'MESSAGE_FAILED',
      severity: 'WARNING',
      title: 'Mensagem não entregue',
      body:
        (error?.code !== undefined ? WHATSAPP_ERROR_HINTS[error.code] : undefined) ??
        error?.title ??
        'A Meta informou falha na entrega.',
      link: `/app/conversations/${message.conversationId}`,
    });
  }
  return 'updated';
}
