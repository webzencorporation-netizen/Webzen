import type { CustomFieldTarget, CustomFieldType, Prisma } from '@botsaas/database';
import { ConflictError, NotFoundError, ValidationError } from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { emitDomainEvent } from '../../../lib/events';
import { sanitizeCustomFields } from '../custom-fields';

// ── Etapas do funil ─────────────────────────────────────────────────────────

export function listStages(scope: CompanyScope) {
  return scope.db.leadStage.findMany({
    orderBy: { position: 'asc' },
    include: { _count: { select: { leads: true } } },
  });
}

export async function createStage(
  scope: CompanyScope,
  input: { name: string; color?: string; isWon?: boolean; isLost?: boolean },
) {
  const key =
    input.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'ETAPA';
  if (await scope.db.leadStage.findFirst({ where: { key } }))
    throw new ConflictError('Já existe uma etapa com esse nome.');
  const last = await scope.db.leadStage.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return scope.db.leadStage.create({
    data: {
      companyId: scope.companyId,
      key,
      name: input.name,
      color: input.color ?? '#64748b',
      position: (last?.position ?? -1) + 1,
      isWon: input.isWon ?? false,
      isLost: input.isLost ?? false,
    },
  });
}

export async function updateStage(
  scope: CompanyScope,
  id: string,
  input: { name?: string; color?: string; isWon?: boolean; isLost?: boolean },
) {
  if (!(await scope.db.leadStage.findUnique({ where: { id }, select: { id: true } })))
    throw new NotFoundError('Etapa não encontrada.');
  return scope.db.leadStage.update({ where: { id }, data: input });
}

export async function reorderStages(scope: CompanyScope, orderedIds: string[]) {
  const stages = await scope.db.leadStage.findMany({ select: { id: true } });
  if (
    stages.length !== orderedIds.length ||
    !stages.every((stage) => orderedIds.includes(stage.id))
  ) {
    throw new ValidationError('Lista de etapas inválida.');
  }
  for (const [position, id] of orderedIds.entries()) {
    await scope.db.leadStage.update({ where: { id }, data: { position } });
  }
  return listStages(scope);
}

export async function deleteStage(scope: CompanyScope, id: string) {
  const stage = await scope.db.leadStage.findUnique({
    where: { id },
    include: { _count: { select: { leads: true } } },
  });
  if (!stage) throw new NotFoundError('Etapa não encontrada.');
  if (stage._count.leads > 0)
    throw new ConflictError('Mova os leads desta etapa antes de excluí-la.');
  await scope.db.leadStage.delete({ where: { id } });
}

// ── Leads (Kanban) ──────────────────────────────────────────────────────────

const leadInclude = {
  contact: {
    select: {
      id: true,
      name: true,
      phone: true,
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
    },
  },
  assignee: { select: { id: true, name: true } },
  stage: { select: { id: true, key: true, name: true, color: true } },
} satisfies Prisma.LeadInclude;

export async function listLeads(
  scope: CompanyScope,
  query: {
    search?: string;
    assigneeId?: string;
    tagId?: string;
    stageId?: string;
    includeClosed?: boolean;
  },
) {
  const leads = await scope.db.lead.findMany({
    where: {
      ...(query.includeClosed
        ? {}
        : {
            OR: [
              { closedAt: null },
              { closedAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
            ],
          }),
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.tagId ? { contact: { tags: { some: { tagId: query.tagId } } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { contact: { name: { contains: query.search, mode: 'insensitive' } } },
              { contact: { phone: { contains: query.search } } },
            ],
          }
        : {}),
    },
    include: leadInclude,
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    take: 1000,
  });
  return leads;
}

async function assertMember(scope: CompanyScope, userId: string | null | undefined) {
  if (!userId) return;
  if (!(await scope.db.companyMember.findFirst({ where: { userId, isActive: true } })))
    throw new ValidationError('Responsável não pertence à empresa.');
}

export async function createLead(
  scope: CompanyScope,
  input: {
    contactId: string;
    stageId?: string;
    title?: string | null;
    valueCents?: number | null;
    assigneeId?: string | null;
  },
) {
  const contact = await scope.db.contact.findUnique({
    where: { id: input.contactId },
    select: { id: true },
  });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  const stage = input.stageId
    ? await scope.db.leadStage.findUnique({ where: { id: input.stageId } })
    : await scope.db.leadStage.findFirst({ orderBy: { position: 'asc' } });
  if (!stage) throw new ValidationError('Etapa inválida.');
  await assertMember(scope, input.assigneeId);
  const lead = await scope.db.lead.create({
    data: {
      companyId: scope.companyId,
      contactId: contact.id,
      stageId: stage.id,
      title: input.title ?? null,
      valueCents: input.valueCents ?? null,
      assigneeId: input.assigneeId ?? null,
      source: 'manual',
      position: Date.now(),
    },
    include: leadInclude,
  });
  await emitDomainEvent(scope, 'lead.created', { leadId: lead.id, contactId: contact.id });
  return lead;
}

export async function updateLead(
  scope: CompanyScope,
  id: string,
  input: {
    title?: string | null;
    valueCents?: number | null;
    assigneeId?: string | null;
    qualification?: Record<string, unknown>;
  },
) {
  const lead = await scope.db.lead.findUnique({ where: { id } });
  if (!lead) throw new NotFoundError('Lead não encontrado.');
  await assertMember(scope, input.assigneeId);
  let qualification: Prisma.InputJsonValue | undefined;
  if (input.qualification) {
    const definitions = await scope.db.customFieldDefinition.findMany({
      where: { target: 'LEAD' },
    });
    qualification = {
      ...((lead.qualification as Record<string, unknown> | null) ?? {}),
      ...sanitizeCustomFields(definitions, input.qualification),
    } as Prisma.InputJsonValue;
  }
  return scope.db.lead.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.valueCents !== undefined ? { valueCents: input.valueCents } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(qualification ? { qualification } : {}),
    },
    include: leadInclude,
  });
}

/** Move lead de etapa (drag and drop no Kanban). */
export async function moveLead(
  scope: CompanyScope,
  id: string,
  input: { stageId: string; position?: number },
) {
  const [lead, stage] = await Promise.all([
    scope.db.lead.findUnique({ where: { id } }),
    scope.db.leadStage.findUnique({ where: { id: input.stageId } }),
  ]);
  if (!lead) throw new NotFoundError('Lead não encontrado.');
  if (!stage) throw new ValidationError('Etapa inválida.');
  const updated = await scope.db.lead.update({
    where: { id },
    data: {
      stageId: stage.id,
      position: input.position ?? Date.now(),
      closedAt: stage.isWon || stage.isLost ? (lead.closedAt ?? new Date()) : null,
    },
    include: leadInclude,
  });
  if (lead.stageId !== stage.id) {
    await emitDomainEvent(scope, 'lead.stage_changed', {
      leadId: id,
      contactId: lead.contactId,
      fromStageId: lead.stageId,
      toStageId: stage.id,
      by: 'USER',
    });
  }
  return updated;
}

export async function deleteLead(scope: CompanyScope, id: string) {
  const result = await scope.db.lead.deleteMany({ where: { id } });
  if (result.count === 0) throw new NotFoundError('Lead não encontrado.');
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

export function listTags(scope: CompanyScope) {
  return scope.db.tag.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { contacts: true } } },
  });
}

export function createTag(scope: CompanyScope, input: { name: string; color?: string }) {
  return scope.db.tag.create({
    data: { companyId: scope.companyId, name: input.name.trim(), color: input.color ?? '#64748b' },
  });
}

export async function updateTag(
  scope: CompanyScope,
  id: string,
  input: { name?: string; color?: string },
) {
  if (!(await scope.db.tag.findUnique({ where: { id }, select: { id: true } })))
    throw new NotFoundError('Etiqueta não encontrada.');
  return scope.db.tag.update({ where: { id }, data: input });
}

export async function deleteTag(scope: CompanyScope, id: string) {
  const result = await scope.db.tag.deleteMany({ where: { id } });
  if (result.count === 0) throw new NotFoundError('Etiqueta não encontrada.');
}

// ── Campos personalizados / qualificação ───────────────────────────────────

export function listCustomFields(scope: CompanyScope) {
  return scope.db.customFieldDefinition.findMany({
    orderBy: [{ target: 'asc' }, { position: 'asc' }],
  });
}

export interface CustomFieldInput {
  target: CustomFieldTarget;
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  collectByAgent?: boolean;
  agentHint?: string | null;
}

export async function createCustomField(scope: CompanyScope, input: CustomFieldInput) {
  if (input.type === 'SELECT' && (!input.options || input.options.length === 0))
    throw new ValidationError('Informe as opções do campo.');
  const last = await scope.db.customFieldDefinition.findFirst({
    where: { target: input.target },
    orderBy: { position: 'desc' },
  });
  const field = await scope.db.customFieldDefinition.create({
    data: {
      companyId: scope.companyId,
      ...input,
      options: input.options ?? [],
      position: (last?.position ?? -1) + 1,
    },
  });
  await audit(scope, {
    action: 'custom_field.created',
    resourceType: 'CustomFieldDefinition',
    resourceId: field.id,
    metadata: { key: field.key },
  });
  return field;
}

export async function updateCustomField(
  scope: CompanyScope,
  id: string,
  input: Partial<Omit<CustomFieldInput, 'key' | 'target'>>,
) {
  if (!(await scope.db.customFieldDefinition.findUnique({ where: { id }, select: { id: true } })))
    throw new NotFoundError('Campo não encontrado.');
  return scope.db.customFieldDefinition.update({ where: { id }, data: input });
}

export async function deleteCustomField(scope: CompanyScope, id: string) {
  const result = await scope.db.customFieldDefinition.deleteMany({ where: { id } });
  if (result.count === 0) throw new NotFoundError('Campo não encontrado.');
}
