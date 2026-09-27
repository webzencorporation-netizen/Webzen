import { ToolRegistry, type ToolHandlers, type ToolResult } from '@botsaas/ai';
import type { Prisma } from '@botsaas/database';
import {
  AppError,
  formatWeeklySchedule,
  getLocalDateParts,
  isOpenAt,
  type WeeklySchedule,
} from '@botsaas/shared';
import type { CompanyScope } from '../../context';
import { getOwnCompany } from '../../lib/company-record';
import { emitDomainEvent } from '../../lib/events';
import { formatSlot } from '../calendar/availability';
import {
  cancelAppointment,
  createAppointment,
  getAvailableSlots,
  rescheduleAppointment,
} from '../calendar/service';
import {
  isSensitiveMemory,
  updateContact,
  upsertMemory,
  createNote,
} from '../company/contacts/service';
import { sanitizeCustomFields } from '../company/custom-fields';
import { formatAddress, type CompanyAddress } from '../company/settings/service';
import { ensureLeadForContact } from '../messaging/conversations';
import { knowledgeRetriever } from '../knowledge/retriever';

/** Contexto das tools: empresa e cliente vêm da CONVERSA, nunca do modelo. */
export interface AgentToolContext {
  scope: CompanyScope;
  conversationId: string;
  contactId: string;
}

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string, code = 'error'): ToolResult => ({ ok: false, error, code });

function formatPrice(cents: number | null, currency = 'BRL'): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

function priceInfo(
  item: { priceCents: number | null; priceNote: string | null; priceVisibleToAi: boolean },
  currency: string,
) {
  if (!item.priceVisibleToAi)
    return { price: null, priceNote: 'Preço informado somente pela equipe (não informe valores).' };
  if (item.priceCents === null)
    return {
      price: null,
      priceNote: item.priceNote ?? 'Preço não cadastrado — não informe valores.',
    };
  return { price: formatPrice(item.priceCents, currency), priceNote: item.priceNote };
}

function textFilter(query: string | undefined): Prisma.StringFilter | undefined {
  return query ? { contains: query, mode: 'insensitive' } : undefined;
}

/** Converte erros de domínio em resultado estruturado (mensagem segura para o modelo). */
async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError && error.httpStatus < 500) return fail(error.message, error.code);
    throw error;
  }
}

function parseFutureDate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export const agentToolHandlers: ToolHandlers<AgentToolContext> = {
  get_company_information: {
    handler: async (_input, { scope }) => {
      const company = await getOwnCompany(scope);
      return ok({
        name: company.name,
        description: company.description,
        address: formatAddress(company.address as CompanyAddress | null),
        mapsUrl: (company.address as CompanyAddress | null)?.mapsUrl ?? null,
        phone: company.phone,
        email: company.email,
        website: company.website,
      });
    },
  },

  search_knowledge: {
    handler: async ({ query }, { scope }) => {
      const hits = await knowledgeRetriever.search(scope.companyId, query, 5);
      if (hits.length === 0)
        return ok({
          results: [],
          note: 'Nada encontrado na base de conhecimento. Não invente a resposta.',
        });
      return ok({
        results: hits.map((hit) => ({ title: hit.title, content: hit.content.slice(0, 1500) })),
      });
    },
  },

  search_products: {
    handler: async ({ query, category, filters }, { scope }) => {
      const company = await getOwnCompany(scope);
      const products = await scope.db.product.findMany({
        where: {
          isActive: true,
          ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
          ...(query
            ? {
                OR: [
                  { name: textFilter(query) },
                  { description: textFilter(query) },
                  { category: textFilter(query) },
                ],
              }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: 50,
      });
      const filtered = products.filter((product) => {
        if (!filters) return true;
        const attributes = (product.attributes ?? {}) as Record<string, unknown>;
        return Object.entries(filters).every(([key, value]) => {
          const actual = attributes[key];
          if (typeof value === 'string' && typeof actual === 'string')
            return actual.toLowerCase().includes(value.toLowerCase());
          return actual === value;
        });
      });
      return ok({
        results: filtered.slice(0, 8).map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          category: product.category,
          ...priceInfo(product, company.currency),
          availability: product.trackStock
            ? (product.stockQuantity ?? 0) > 0
              ? 'em estoque'
              : 'sem estoque'
            : 'disponível',
          attributes: product.attributes,
        })),
        total: filtered.length,
      });
    },
  },

  search_services: {
    handler: async ({ query }, { scope }) => {
      const company = await getOwnCompany(scope);
      let services = await scope.db.service.findMany({
        where: {
          isActive: true,
          ...(query
            ? {
                OR: [
                  { name: textFilter(query) },
                  { description: textFilter(query) },
                  { category: textFilter(query) },
                ],
              }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: 10,
      });
      // Consulta muito específica sem resultado: devolve o catálogo para o modelo escolher.
      if (services.length === 0 && query)
        services = await scope.db.service.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          take: 15,
        });
      return ok({
        results: services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          category: service.category,
          durationMinutes: service.durationMinutes,
          ...priceInfo(service, company.currency),
        })),
      });
    },
  },

  get_business_hours: {
    handler: async ({ date }, { scope }) => {
      const company = await getOwnCompany(scope);
      const schedule = (company.businessHours ?? []) as WeeklySchedule;
      const today = getLocalDateParts(new Date(), company.timezone).date;
      const holidays = await scope.db.holiday.findMany({
        where: { date: { gte: today } },
        orderBy: { date: 'asc' },
        take: 10,
      });
      if (schedule.length === 0)
        return fail(
          'Horário de funcionamento não cadastrado. Não invente horários.',
          'not_configured',
        );
      return ok({
        weekly: formatWeeklySchedule(schedule),
        openNow: isOpenAt(schedule, holidays, new Date(), company.timezone),
        timezone: company.timezone,
        upcomingHolidays: holidays.map((holiday) => ({
          date: holiday.date,
          name: holiday.name,
          closed: holiday.closed,
          specialHours: holiday.closed ? null : `${holiday.open}–${holiday.close}`,
        })),
        requestedDate: date ?? null,
      });
    },
  },

  get_contact: {
    handler: async (_input, { scope, contactId }) => {
      const contact = await scope.db.contact.findUnique({ where: { id: contactId } });
      if (!contact) return fail('Contato não encontrado.', 'not_found');
      return ok({
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        customFields: contact.customFields,
      });
    },
  },

  update_contact: {
    handler: async (input, { scope, contactId }, meta) =>
      guarded(async () => {
        if (meta.dryRun) return ok({ simulated: true, wouldUpdate: input });
        const updated = await updateContact(scope, contactId, input);
        return ok({ updated: true, name: updated.name, email: updated.email });
      }),
  },

  create_contact_note: {
    handler: async ({ note }, { scope, contactId }, meta) =>
      guarded(async () => {
        if (meta.dryRun) return ok({ simulated: true });
        await createNote(scope, contactId, note);
        return ok({ saved: true });
      }),
  },

  save_contact_memory: {
    handler: async ({ key, value }, { scope, contactId }, meta) =>
      guarded(async () => {
        if (isSensitiveMemory(value))
          return fail('Informação sensível não deve ser armazenada.', 'sensitive_data');
        if (meta.dryRun) return ok({ simulated: true });
        await upsertMemory(scope, contactId, key, value);
        return ok({ saved: true });
      }),
  },

  update_lead_stage: {
    handler: async ({ stageKey, reason }, { scope, contactId }, meta) =>
      guarded(async () => {
        const stage = await scope.db.leadStage.findFirst({ where: { key: stageKey } });
        if (!stage) return fail(`Etapa "${stageKey}" não existe.`, 'not_found');
        if (meta.dryRun) return ok({ simulated: true, stage: stage.name });
        const lead =
          (await scope.db.lead.findFirst({ where: { contactId, closedAt: null } })) ??
          (await ensureLeadForContact(scope, contactId, 'agent'));
        if (!lead) return fail('CRM não habilitado.', 'feature_disabled');
        if (lead.stageId === stage.id) return ok({ unchanged: true, stage: stage.name });
        await scope.db.lead.update({
          where: { id: lead.id },
          data: { stageId: stage.id, closedAt: stage.isWon || stage.isLost ? new Date() : null },
        });
        await emitDomainEvent(scope, 'lead.stage_changed', {
          leadId: lead.id,
          contactId,
          fromStageId: lead.stageId,
          toStageId: stage.id,
          by: 'AI',
          reason: reason ?? null,
        });
        return ok({ moved: true, stage: stage.name });
      }),
  },

  update_lead_qualification: {
    handler: async ({ fields }, { scope, contactId }, meta) =>
      guarded(async () => {
        const definitions = await scope.db.customFieldDefinition.findMany({
          where: { target: 'LEAD' },
        });
        const sanitized = sanitizeCustomFields(definitions, fields, { ignoreUnknown: true });
        if (Object.keys(sanitized).length === 0)
          return fail('Nenhum campo de qualificação válido informado.', 'invalid_input');
        if (meta.dryRun) return ok({ simulated: true, fields: sanitized });
        const lead =
          (await scope.db.lead.findFirst({ where: { contactId, closedAt: null } })) ??
          (await ensureLeadForContact(scope, contactId, 'agent'));
        if (!lead) return fail('CRM não habilitado.', 'feature_disabled');
        await scope.db.lead.update({
          where: { id: lead.id },
          data: {
            qualification: {
              ...((lead.qualification as Record<string, unknown> | null) ?? {}),
              ...sanitized,
            } as Prisma.InputJsonValue,
          },
        });
        return ok({ saved: Object.keys(sanitized) });
      }),
  },

  get_available_appointments: {
    handler: async ({ serviceId, date, days }, { scope }) =>
      guarded(async () => {
        const result = await getAvailableSlots(scope, { serviceId, date, days, maxSlots: 12 });
        if (result.slots.length === 0)
          return ok({ slots: [], note: 'Sem horários livres no período. Ofereça outro dia.' });
        return ok({
          timezone: result.timezone,
          durationMinutes: result.durationMinutes,
          slots: result.slots.map((slot) => ({
            startAt: slot.start.toISOString(),
            label: formatSlot(slot, result.timezone),
          })),
        });
      }),
  },

  create_appointment: {
    handler: async ({ serviceId, startAt, notes }, { scope, contactId }, meta) =>
      guarded(async () => {
        const start = parseFutureDate(startAt);
        if (!start || start.getTime() < Date.now())
          return fail('Data/hora inválida ou no passado.', 'invalid_input');
        if (meta.dryRun) {
          const company = await getOwnCompany(scope);
          return ok({
            simulated: true,
            startAt: start.toISOString(),
            label: formatSlot({ start, end: start }, company.timezone),
          });
        }
        const appointment = await createAppointment(scope, {
          contactId,
          serviceId,
          startAt: start,
          notes,
          status: 'CONFIRMED',
        });
        return ok({
          appointmentId: appointment.id,
          service: appointment.service?.name ?? null,
          startAt: appointment.startAt.toISOString(),
          label: formatSlot(
            { start: appointment.startAt, end: appointment.endAt },
            appointment.timezone,
          ),
          status: appointment.status,
        });
      }),
  },

  reschedule_appointment: {
    handler: async ({ appointmentId, newStartAt }, { scope, contactId }, meta) =>
      guarded(async () => {
        const appointment = await scope.db.appointment.findUnique({ where: { id: appointmentId } });
        // O cliente só pode mexer nos próprios agendamentos.
        if (!appointment || appointment.contactId !== contactId)
          return fail('Agendamento não encontrado para este cliente.', 'not_found');
        const start = parseFutureDate(newStartAt);
        if (!start || start.getTime() < Date.now())
          return fail('Data/hora inválida ou no passado.', 'invalid_input');
        if (meta.dryRun) return ok({ simulated: true, newStartAt: start.toISOString() });
        const updated = await rescheduleAppointment(scope, appointmentId, start);
        return ok({
          rescheduled: true,
          label: formatSlot({ start: updated.startAt, end: updated.endAt }, updated.timezone),
        });
      }),
  },

  cancel_appointment: {
    handler: async ({ appointmentId, reason }, { scope, contactId }, meta) =>
      guarded(async () => {
        const appointment = await scope.db.appointment.findUnique({ where: { id: appointmentId } });
        if (!appointment || appointment.contactId !== contactId)
          return fail('Agendamento não encontrado para este cliente.', 'not_found');
        if (meta.dryRun) return ok({ simulated: true, cancelled: true });
        await cancelAppointment(
          scope,
          appointmentId,
          reason ?? 'Cancelado pelo cliente via WhatsApp',
        );
        return ok({ cancelled: true });
      }),
  },

  list_contact_appointments: {
    handler: async (_input, { scope, contactId }) => {
      const appointments = await scope.db.appointment.findMany({
        where: {
          contactId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startAt: { gte: new Date() },
        },
        include: { service: { select: { name: true } } },
        orderBy: { startAt: 'asc' },
        take: 5,
      });
      return ok({
        appointments: appointments.map((item) => ({
          appointmentId: item.id,
          service: item.service?.name ?? null,
          startAt: item.startAt.toISOString(),
          label: formatSlot({ start: item.startAt, end: item.endAt }, item.timezone),
          status: item.status,
        })),
      });
    },
  },

  request_human_handoff: {
    // A mudança de estado é aplicada pelo orquestrador após a execução (funciona também em simulação).
    handler: async ({ reason, urgent }) =>
      ({
        ok: true,
        data: { transferred: true },
        effects: { handoff: { reason: urgent ? `[URGENTE] ${reason}` : reason } },
      }) satisfies ToolResult,
  },
};

export const agentToolRegistry = ToolRegistry.fromHandlers(agentToolHandlers);
