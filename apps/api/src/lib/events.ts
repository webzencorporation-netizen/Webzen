import type { Prisma } from '@botsaas/database';
import type { AutomationTrigger } from '@botsaas/shared';
import type { CompanyScope } from '../context';

/** Eventos internos (outbox). Automações e notificações reagem a eles de forma assíncrona. */
export type DomainEventType = AutomationTrigger | 'message.sent' | 'agent.failed' | 'lead.created';

export async function emitDomainEvent(
  scope: CompanyScope,
  type: DomainEventType,
  payload: Record<string, unknown>,
): Promise<string> {
  const event = await scope.db.domainEvent.create({
    data: { companyId: scope.companyId, type, payload: payload as Prisma.InputJsonValue },
  });
  await scope.container.queue.enqueue(
    'domain-event.dispatch',
    { companyId: scope.companyId, eventId: event.id },
    { jobId: `event-${event.id}` },
  );
  return event.id;
}
