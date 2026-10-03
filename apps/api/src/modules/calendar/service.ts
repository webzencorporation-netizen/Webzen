import type { AppointmentStatus, Prisma } from '@botsaas/database';
import {
  GoogleCalendarProvider,
  GoogleReauthorizationRequiredError,
  type CalendarProvider,
  type GoogleTokens,
} from '@botsaas/integrations';
import {
  ConflictError,
  IntegrationError,
  NotFoundError,
  ValidationError,
  type WeeklySchedule,
} from '@botsaas/shared';
import { addMinutes } from 'date-fns';
import type { CompanyDataScope, CompanyScope } from '../../context';
import { audit } from '../../lib/audit';
import { getOwnCompany } from '../../lib/company-record';
import { emitDomainEvent } from '../../lib/events';
import { notify } from '../../lib/notifications';
import { computeAvailableSlots, type Interval } from './availability';

export const DEFAULT_DURATION_MINUTES = 30;
const ACTIVE_STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED'];

const appointmentInclude = {
  contact: { select: { id: true, name: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
} satisfies Prisma.AppointmentInclude;

/**
 * Provider externo conectado (Google) ou null quando só a agenda interna está ativa.
 * Uma integração que deveria bloquear horários, mas não pode ser usada, recusa a consulta:
 * ignorá-la permitiria marcar por cima de compromissos do Google.
 */
export async function getCalendarProvider(
  scope: CompanyScope,
): Promise<{ provider: CalendarProvider; integrationId: string } | null> {
  const integration = await scope.db.integration.findFirst({
    where: { provider: 'GOOGLE_CALENDAR', status: { in: ['CONNECTED', 'ERROR'] } },
  });
  if (!integration) return null;
  if (integration.status === 'ERROR') {
    throw new IntegrationError(
      'Google Agenda desconectada por falha de autorização — reconecte em Integrações para voltar a consultar horários.',
    );
  }
  const { secrets } = scope.container;
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = scope.container.env;
  const redirectUri = scope.container.env.GOOGLE_REDIRECT_URI;
  const credentials = integration.credentialsEncrypted;
  if (!credentials || !secrets || !clientId || !clientSecret || !redirectUri) {
    const missing = [
      !credentials && 'credenciais da integração',
      !secrets && 'ENCRYPTION_KEY',
      !clientId && 'GOOGLE_CLIENT_ID',
      !clientSecret && 'GOOGLE_CLIENT_SECRET',
      !redirectUri && 'GOOGLE_REDIRECT_URI',
    ].filter(Boolean);
    throw new IntegrationError(
      `Google Agenda conectada, mas indisponível nesta instalação (ausente: ${missing.join(', ')}).`,
    );
  }
  const tokens = JSON.parse(secrets.decrypt(credentials)) as GoogleTokens;
  const config = (integration.config ?? {}) as { calendarId?: string };
  const provider = new GoogleCalendarProvider({
    oauth: { clientId, clientSecret, redirectUri },
    tokens,
    calendarId: config.calendarId,
    onTokensRefreshed: async (refreshed) => {
      await scope.db.integration.update({
        where: { id: integration.id },
        data: { credentialsEncrypted: secrets.encrypt(JSON.stringify(refreshed)) },
      });
    },
    onReauthorizationRequired: async () => {
      // Só a transição CONNECTED → ERROR notifica; consultas seguintes recusam antes da rede.
      const { count } = await scope.db.integration.updateMany({
        where: { id: integration.id, status: 'CONNECTED' },
        data: { status: 'ERROR', lastError: new GoogleReauthorizationRequiredError().message },
      });
      if (count === 0) return;
      await notify(scope, {
        type: 'INTEGRATION_DISCONNECTED',
        severity: 'CRITICAL',
        title: 'Google Agenda desconectada',
        body: 'A autorização do Google expirou ou foi revogada. Reconecte para o agente voltar a consultar e marcar horários.',
        link: '/app/integrations',
      });
    },
  });
  return { provider, integrationId: integration.id };
}

async function appointmentBusy(
  scope: CompanyDataScope,
  range: Interval,
  excludeId?: string,
): Promise<Interval[]> {
  const appointments = await scope.db.appointment.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      startAt: { lt: range.end },
      endAt: { gt: range.start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startAt: true, endAt: true },
  });
  return appointments.map((item) => ({ start: item.startAt, end: item.endAt }));
}

/** Compromissos do calendário externo também bloqueiam a agenda (inclui eventos espelhados por nós). */
async function externalBusy(
  scope: CompanyScope,
  range: Interval,
  timezone: string,
): Promise<Interval[]> {
  const external = await getCalendarProvider(scope);
  return external ? external.provider.getAvailability({ ...range, timezone }) : [];
}

async function busyIntervals(
  scope: CompanyScope,
  range: Interval,
  timezone: string,
  excludeId?: string,
): Promise<Interval[]> {
  return [
    ...(await appointmentBusy(scope, range, excludeId)),
    ...(await externalBusy(scope, range, timezone)),
  ];
}

/** Namespace fixo do advisory lock da agenda; a segunda chave é o hash da empresa. */
const SCHEDULE_LOCK_NAMESPACE = 20260929;

/**
 * Serializa "verificar horário livre → gravar" por empresa. Sem isso, pedidos simultâneos
 * (painel, agente e automações) liam a agenda antes de qualquer gravação e reservavam o mesmo
 * horário. O lock é liberado no commit/rollback; a consulta ao calendário externo (rede) fica
 * fora da transação para não segurá-lo.
 */
async function withScheduleLock<T>(
  scope: CompanyScope,
  fn: (locked: CompanyDataScope) => Promise<T>,
): Promise<T> {
  return scope.db.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_NAMESPACE}::int, hashtext(${scope.companyId}))::text`;
    return fn({ ...scope, db });
  });
}

function assertIntervalFree(busy: Interval[], interval: Interval) {
  if (busy.some((item) => item.start < interval.end && interval.start < item.end)) {
    throw new ConflictError('Horário indisponível. Escolha outro horário.');
  }
}

async function serviceDuration(
  scope: CompanyScope,
  serviceId?: string | null,
): Promise<{ duration: number; serviceId: string | null }> {
  if (!serviceId) return { duration: DEFAULT_DURATION_MINUTES, serviceId: null };
  const service = await scope.db.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.isActive) throw new NotFoundError('Serviço não encontrado.');
  return { duration: service.durationMinutes ?? DEFAULT_DURATION_MINUTES, serviceId: service.id };
}

export async function getAvailableSlots(
  scope: CompanyScope,
  input: { serviceId?: string | null; date: string; days?: number; maxSlots?: number },
) {
  const company = await getOwnCompany(scope);
  const schedule = (company.businessHours ?? []) as WeeklySchedule;
  if (schedule.length === 0)
    throw new ValidationError('A empresa ainda não configurou o horário de funcionamento.');
  const { duration } = await serviceDuration(scope, input.serviceId);
  const days = Math.min(Math.max(input.days ?? 1, 1), 14);
  const rangeStart = new Date(`${input.date}T00:00:00Z`);
  const range = {
    start: addMinutes(rangeStart, -24 * 60),
    end: addMinutes(rangeStart, (days + 1) * 24 * 60),
  };
  const [holidays, busy] = await Promise.all([
    scope.db.holiday.findMany(),
    busyIntervals(scope, range, company.timezone),
  ]);
  const slots = computeAvailableSlots({
    fromDate: input.date,
    days,
    durationMinutes: duration,
    timezone: company.timezone,
    schedule,
    holidays,
    busy,
    now: new Date(),
    maxSlots: input.maxSlots ?? 40,
  });
  return { timezone: company.timezone, durationMinutes: duration, slots };
}

export async function listAppointments(
  scope: CompanyScope,
  query: { from: Date; to: Date; status?: AppointmentStatus; contactId?: string },
) {
  return scope.db.appointment.findMany({
    where: {
      startAt: { gte: query.from, lt: query.to },
      ...(query.status ? { status: query.status } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
    },
    include: appointmentInclude,
    orderBy: { startAt: 'asc' },
    take: 500,
  });
}

export interface CreateAppointmentInput {
  contactId: string;
  serviceId?: string | null;
  startAt: Date;
  endAt?: Date | null;
  notes?: string | null;
  status?: AppointmentStatus;
  enforceAvailability?: boolean;
}

export async function createAppointment(scope: CompanyScope, input: CreateAppointmentInput) {
  const company = await getOwnCompany(scope);
  const contact = await scope.db.contact.findUnique({
    where: { id: input.contactId },
    select: { id: true },
  });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  const { duration, serviceId } = await serviceDuration(scope, input.serviceId);
  const endAt = input.endAt ?? addMinutes(input.startAt, duration);
  if (endAt <= input.startAt)
    throw new ValidationError('Horário final deve ser depois do inicial.');
  const interval = { start: input.startAt, end: endAt };
  // Encaixe manual (enforceAvailability=false) é permitido de propósito pelo painel.
  const enforce = input.enforceAvailability !== false;
  const external = enforce ? await externalBusy(scope, interval, company.timezone) : [];

  const appointment = await withScheduleLock(scope, async (locked) => {
    if (enforce)
      assertIntervalFree([...(await appointmentBusy(locked, interval)), ...external], interval);
    return locked.db.appointment.create({
      data: {
        companyId: scope.companyId,
        contactId: contact.id,
        serviceId,
        startAt: input.startAt,
        endAt,
        timezone: company.timezone,
        status: input.status ?? 'CONFIRMED',
        notes: input.notes ?? null,
        createdByType: scope.actor.type === 'PLATFORM_ADMIN' ? 'USER' : scope.actor.type,
        createdById: scope.actor.userId ?? null,
      },
      include: appointmentInclude,
    });
  });
  await enqueueCalendarSync(scope, appointment.id, 'create');
  await emitDomainEvent(scope, 'appointment.created', {
    appointmentId: appointment.id,
    contactId: contact.id,
    startAt: appointment.startAt.toISOString(),
  });
  return appointment;
}

export async function rescheduleAppointment(scope: CompanyScope, id: string, startAt: Date) {
  const current = await scope.db.appointment.findUnique({ where: { id } });
  if (!current || !ACTIVE_STATUSES.includes(current.status))
    throw new NotFoundError('Agendamento não encontrado ou já encerrado.');
  const duration = current.endAt.getTime() - current.startAt.getTime();
  const endAt = new Date(startAt.getTime() + duration);
  const interval = { start: startAt, end: endAt };
  const external = await externalBusy(scope, interval, current.timezone);
  const appointment = await withScheduleLock(scope, async (locked) => {
    assertIntervalFree(
      [...(await appointmentBusy(locked, interval, current.id)), ...external],
      interval,
    );
    return locked.db.appointment.update({
      where: { id },
      data: { startAt, endAt, reminderSentAt: null },
      include: appointmentInclude,
    });
  });
  await enqueueCalendarSync(scope, id, 'update');
  await audit(scope, {
    action: 'appointment.rescheduled',
    resourceType: 'Appointment',
    resourceId: id,
    metadata: { from: current.startAt, to: startAt },
  });
  return appointment;
}

export async function cancelAppointment(scope: CompanyScope, id: string, reason?: string | null) {
  const current = await scope.db.appointment.findUnique({ where: { id } });
  if (!current) throw new NotFoundError('Agendamento não encontrado.');
  if (current.status === 'CANCELLED')
    return scope.db.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
  const appointment = await scope.db.appointment.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledReason: reason ?? null },
    include: appointmentInclude,
  });
  await enqueueCalendarSync(scope, id, 'delete');
  await emitDomainEvent(scope, 'appointment.cancelled', {
    appointmentId: id,
    contactId: current.contactId,
    reason: reason ?? null,
  });
  return appointment;
}

export async function updateAppointmentStatus(
  scope: CompanyScope,
  id: string,
  status: AppointmentStatus,
) {
  if (status === 'CANCELLED') return cancelAppointment(scope, id);
  const current = await scope.db.appointment.findUnique({ where: { id } });
  if (!current) throw new NotFoundError('Agendamento não encontrado.');
  const update = (db: CompanyDataScope['db']) =>
    db.appointment.update({ where: { id }, data: { status }, include: appointmentInclude });
  // Só reativar (encerrado → ativo) volta a ocupar a agenda; o horário pode ter sido tomado.
  if (!ACTIVE_STATUSES.includes(status) || ACTIVE_STATUSES.includes(current.status))
    return update(scope.db);
  const interval = { start: current.startAt, end: current.endAt };
  const external = await externalBusy(scope, interval, current.timezone);
  return withScheduleLock(scope, async (locked) => {
    assertIntervalFree(
      [...(await appointmentBusy(locked, interval, current.id)), ...external],
      interval,
    );
    return update(locked.db);
  });
}

async function enqueueCalendarSync(
  scope: CompanyScope,
  appointmentId: string,
  action: 'create' | 'update' | 'delete',
) {
  const integration = await scope.db.integration.findFirst({
    where: { provider: 'GOOGLE_CALENDAR', status: 'CONNECTED' },
    select: { id: true },
  });
  if (!integration) return;
  await scope.container.queue.enqueue(
    'calendar.sync',
    { companyId: scope.companyId, appointmentId, action },
    { jobId: `cal-${appointmentId}-${action}-${Date.now()}` },
  );
}

/** Job `calendar.sync`: espelha o agendamento no calendário externo. */
export async function processCalendarSync(
  scope: CompanyScope,
  appointmentId: string,
  action: 'create' | 'update' | 'delete',
) {
  const external = await getCalendarProvider(scope);
  if (!external) return;
  const appointment = await scope.db.appointment.findUnique({
    where: { id: appointmentId },
    include: appointmentInclude,
  });
  if (!appointment) return;
  const event = {
    title: `${appointment.service?.name ?? 'Atendimento'} — ${appointment.contact.name ?? appointment.contact.phone}`,
    description: appointment.notes ?? undefined,
    start: appointment.startAt,
    end: appointment.endAt,
    timezone: appointment.timezone,
  };
  if (action === 'delete' || appointment.status === 'CANCELLED') {
    if (appointment.externalId) await external.provider.deleteEvent(appointment.externalId);
    return;
  }
  if (appointment.externalId) {
    await external.provider.updateEvent(appointment.externalId, event);
  } else {
    const created = await external.provider.createEvent(event);
    await scope.db.appointment.update({
      where: { id: appointment.id },
      data: { externalId: created.externalId, integrationId: external.integrationId },
    });
  }
  await scope.db.integration.update({
    where: { id: external.integrationId },
    data: { lastSyncAt: new Date(), lastError: null },
  });
}
