import type { Prisma } from '@botsaas/database';
import type { AutomationTrigger } from '@botsaas/shared';
import type { CompanyDataScope } from '../context';

/** Eventos internos (outbox). Automações e notificações reagem a eles de forma assíncrona. */
export type DomainEventType =
  | AutomationTrigger
  | 'message.sent'
  | 'agent.failed'
  | 'lead.created'
  | 'conversation.closed'
  | 'subscription.updated';

/** Persiste na outbox sem acessar Redis; pode participar de uma transação de domínio. */
export async function recordDomainEvent(
  scope: CompanyDataScope,
  type: DomainEventType,
  payload: Record<string, unknown>,
): Promise<string> {
  const event = await scope.db.domainEvent.create({
    data: { companyId: scope.companyId, type, payload: payload as Prisma.InputJsonValue },
  });
  return event.id;
}

export async function emitDomainEvent(
  scope: CompanyDataScope,
  type: DomainEventType,
  payload: Record<string, unknown>,
): Promise<string> {
  const eventId = await recordDomainEvent(scope, type, payload);
  await scope.container.queue.enqueue(
    'domain-event.dispatch',
    { companyId: scope.companyId, eventId },
    { jobId: `event-${eventId}` },
  );
  return eventId;
}
