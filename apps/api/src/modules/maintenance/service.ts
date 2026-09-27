import { systemDb } from '@botsaas/database';
import type { AppContainer } from '../../container';
import { emitDomainEvent } from '../../lib/events';
import { systemScope } from '../../lib/scope';

const REMINDER_WINDOW_START_MS = 23 * 3600_000;
const REMINDER_WINDOW_END_MS = 25 * 3600_000;

/**
 * Job periódico: emite `appointment.reminder_due` ~24h antes de cada agendamento confirmado.
 * O envio em si é feito por automações (normalmente com template aprovado, já que a janela
 * de 24h pode estar fechada).
 */
export async function emitAppointmentReminders(
  container: AppContainer,
  now = new Date(),
): Promise<number> {
  const due = await systemDb.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      reminderSentAt: null,
      startAt: {
        gte: new Date(now.getTime() + REMINDER_WINDOW_START_MS),
        lt: new Date(now.getTime() + REMINDER_WINDOW_END_MS),
      },
      company: { status: 'ACTIVE' },
    },
    select: { id: true, companyId: true, contactId: true, startAt: true, timezone: true },
    take: 500,
  });
  for (const appointment of due) {
    const scope = systemScope(container, appointment.companyId);
    const claimed = await scope.db.appointment.updateMany({
      where: { id: appointment.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claimed.count === 0) continue;
    const label = new Intl.DateTimeFormat('pt-BR', {
      timeZone: appointment.timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(appointment.startAt);
    await emitDomainEvent(scope, 'appointment.reminder_due', {
      appointmentId: appointment.id,
      contactId: appointment.contactId,
      startAt: appointment.startAt.toISOString(),
      startLabel: label,
    });
  }
  return due.length;
}

/**
 * Job diário de retenção (LGPD): aplica a política de cada empresa e limpa dados técnicos antigos.
 * As regras de retenção são decisão da empresa controladora dos dados.
 */
export async function runRetention(container: AppContainer, now = new Date()) {
  const result = { messages: 0, webhookEvents: 0, sessions: 0, domainEvents: 0 };
  const companies = await systemDb.company.findMany({
    where: { messageRetentionDays: { not: null } },
    select: { id: true, messageRetentionDays: true },
  });
  for (const company of companies) {
    if (!company.messageRetentionDays) continue;
    const cutoff = new Date(now.getTime() - company.messageRetentionDays * 24 * 3600_000);
    const scope = systemScope(container, company.id);
    const media = await scope.db.mediaAsset.findMany({
      where: { createdAt: { lt: cutoff }, storageKey: { not: null } },
      select: { storageKey: true },
    });
    for (const item of media) {
      if (item.storageKey)
        await container.providers.storage.delete(item.storageKey).catch(() => undefined);
    }
    await scope.db.mediaAsset.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const deleted = await scope.db.message.deleteMany({ where: { createdAt: { lt: cutoff } } });
    result.messages += deleted.count;
  }
  const technicalCutoff = new Date(now.getTime() - 30 * 24 * 3600_000);
  result.webhookEvents = (
    await systemDb.webhookEvent.deleteMany({
      where: { receivedAt: { lt: technicalCutoff }, status: { in: ['PROCESSED', 'IGNORED'] } },
    })
  ).count;
  result.domainEvents = (
    await systemDb.domainEvent.deleteMany({ where: { processedAt: { lt: technicalCutoff } } })
  ).count;
  result.sessions = (
    await systemDb.session.deleteMany({ where: { expiresAt: { lt: now } } })
  ).count;
  container.logger.info({ retention: result }, 'Retenção aplicada');
  return result;
}
