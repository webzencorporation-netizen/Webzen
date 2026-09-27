import type { Prisma } from '@botsaas/database';
import { ConflictError, NotFoundError, ValidationError } from '@botsaas/shared';
import { isPlausiblePhone, normalizePhone } from '@botsaas/whatsapp';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { emitDomainEvent } from '../../../lib/events';
import { toSkipTake, type PaginationQuery } from '../../../lib/http';
import { sanitizeCustomFields } from '../custom-fields';

export interface ContactListQuery extends PaginationQuery {
  search?: string;
  tagId?: string;
  assigneeId?: string;
  status?: string;
  sort?: 'recent' | 'name' | 'created';
}

const contactInclude = {
  tags: { include: { tag: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.ContactInclude;

type ContactWithRelations = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

export function toContactDto(contact: ContactWithRelations) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    source: contact.source,
    status: contact.status,
    assignee: contact.assignee,
    tags: contact.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color })),
    customFields: (contact.customFields ?? {}) as Record<string, unknown>,
    lastInteractionAt: contact.lastInteractionAt,
    nextActionAt: contact.nextActionAt,
    nextActionNote: contact.nextActionNote,
    optedOut: contact.optedOut,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

export async function listContacts(scope: CompanyScope, query: ContactListQuery) {
  const where: Prisma.ContactWhereInput = {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search.replace(/\D/g, '') || query.search } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const orderBy: Prisma.ContactOrderByWithRelationInput =
    query.sort === 'name'
      ? { name: 'asc' }
      : query.sort === 'created'
        ? { createdAt: 'desc' }
        : { lastInteractionAt: { sort: 'desc', nulls: 'last' } };
  const [total, items] = await Promise.all([
    scope.db.contact.count({ where }),
    scope.db.contact.findMany({ where, include: contactInclude, orderBy, ...toSkipTake(query) }),
  ]);
  return { items: items.map(toContactDto), total, page: query.page, pageSize: query.pageSize };
}

export async function getContact(scope: CompanyScope, id: string) {
  const contact = await scope.db.contact.findUnique({ where: { id }, include: contactInclude });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  return toContactDto(contact);
}

export interface ContactInput {
  name?: string | null;
  phone?: string;
  email?: string | null;
  source?: string | null;
  status?: string | null;
  assigneeId?: string | null;
  customFields?: Record<string, unknown>;
  nextActionAt?: Date | null;
  nextActionNote?: string | null;
  optedOut?: boolean;
}

async function assertAssigneeIsMember(scope: CompanyScope, userId: string | null | undefined) {
  if (!userId) return;
  const member = await scope.db.companyMember.findFirst({ where: { userId, isActive: true } });
  if (!member) throw new ValidationError('Responsável não pertence à empresa.');
}

async function validatedCustomFields(
  scope: CompanyScope,
  values: Record<string, unknown> | undefined,
  current?: Prisma.JsonValue,
) {
  if (!values) return undefined;
  const definitions = await scope.db.customFieldDefinition.findMany({
    where: { target: 'CONTACT' },
  });
  return {
    ...((current as Record<string, unknown> | null) ?? {}),
    ...sanitizeCustomFields(definitions, values),
  } as Prisma.InputJsonValue;
}

export async function createContact(scope: CompanyScope, input: ContactInput & { phone: string }) {
  const phone = normalizePhone(input.phone);
  if (!isPlausiblePhone(phone)) throw new ValidationError('Telefone inválido.');
  const existing = await scope.db.contact.findUnique({
    where: { companyId_phone: { companyId: scope.companyId, phone } },
  });
  if (existing) throw new ConflictError('Já existe um contato com este telefone.');
  await assertAssigneeIsMember(scope, input.assigneeId);

  const contact = await scope.db.contact.create({
    data: {
      companyId: scope.companyId,
      phone,
      name: input.name ?? null,
      email: input.email ?? null,
      source: input.source ?? 'manual',
      status: input.status ?? null,
      assigneeId: input.assigneeId ?? null,
      customFields: await validatedCustomFields(scope, input.customFields),
      nextActionAt: input.nextActionAt ?? null,
      nextActionNote: input.nextActionNote ?? null,
    },
    include: contactInclude,
  });
  await emitDomainEvent(scope, 'contact.created', {
    contactId: contact.id,
    source: contact.source,
  });
  return toContactDto(contact);
}

export async function updateContact(scope: CompanyScope, id: string, input: ContactInput) {
  const current = await scope.db.contact.findUnique({ where: { id } });
  if (!current) throw new NotFoundError('Contato não encontrado.');
  await assertAssigneeIsMember(scope, input.assigneeId);
  let phone: string | undefined;
  if (input.phone !== undefined) {
    phone = normalizePhone(input.phone);
    if (!isPlausiblePhone(phone)) throw new ValidationError('Telefone inválido.');
  }
  const contact = await scope.db.contact.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(phone ? { phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.nextActionAt !== undefined ? { nextActionAt: input.nextActionAt } : {}),
      ...(input.nextActionNote !== undefined ? { nextActionNote: input.nextActionNote } : {}),
      ...(input.optedOut !== undefined ? { optedOut: input.optedOut } : {}),
      ...(input.customFields
        ? {
            customFields: await validatedCustomFields(
              scope,
              input.customFields,
              current.customFields,
            ),
          }
        : {}),
    },
    include: contactInclude,
  });
  return toContactDto(contact);
}

/** Exclusão definitiva (LGPD): remove contato, conversas, mensagens, mídias, leads, notas e memórias. */
export async function deleteContact(scope: CompanyScope, id: string) {
  const contact = await scope.db.contact.findUnique({ where: { id }, select: { id: true } });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  const media = await scope.db.mediaAsset.findMany({
    where: { message: { conversation: { contactId: id } }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  await scope.db.contact.delete({ where: { id } });
  for (const item of media) {
    if (item.storageKey)
      await scope.container.providers.storage.delete(item.storageKey).catch(() => undefined);
  }
  await audit(scope, {
    action: 'contact.deleted',
    resourceType: 'Contact',
    resourceId: id,
    metadata: { mediaRemoved: media.length },
  });
}

export async function setContactTags(scope: CompanyScope, contactId: string, tagIds: string[]) {
  const contact = await scope.db.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  const tags = await scope.db.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } });
  if (tags.length !== new Set(tagIds).size) throw new ValidationError('Etiqueta inválida.');
  await scope.db.contactTag.deleteMany({ where: { contactId } });
  if (tags.length > 0) {
    await scope.db.contactTag.createMany({
      data: tags.map((tag) => ({ companyId: scope.companyId, contactId, tagId: tag.id })),
    });
  }
  return getContact(scope, contactId);
}

export async function addTagByName(scope: CompanyScope, contactId: string, tagName: string) {
  const tag = await scope.db.tag.upsert({
    where: { companyId_name: { companyId: scope.companyId, name: tagName } },
    create: { companyId: scope.companyId, name: tagName },
    update: {},
  });
  await scope.db.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { companyId: scope.companyId, contactId, tagId: tag.id },
    update: {},
  });
  return tag;
}

// ── Notas ────────────────────────────────────────────────────────────────────

export async function listNotes(scope: CompanyScope, contactId: string) {
  return scope.db.contactNote.findMany({
    where: { contactId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
    take: 200,
  });
}

export async function createNote(scope: CompanyScope, contactId: string, body: string) {
  const contact = await scope.db.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  return scope.db.contactNote.create({
    data: {
      companyId: scope.companyId,
      contactId,
      body,
      authorId: scope.actor.userId ?? null,
      authorType:
        scope.actor.type === 'AI' ? 'AI' : scope.actor.type === 'SYSTEM' ? 'SYSTEM' : 'USER',
    },
    include: { author: { select: { id: true, name: true } } },
  });
}

export async function deleteNote(scope: CompanyScope, noteId: string) {
  const result = await scope.db.contactNote.deleteMany({ where: { id: noteId } });
  if (result.count === 0) throw new NotFoundError('Nota não encontrada.');
}

// ── Memórias ─────────────────────────────────────────────────────────────────

/** Padrões de dados sensíveis que não devem virar memória (CPF, cartão, e-mail de terceiros...). */
const SENSITIVE_PATTERNS = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
  /\b(?:\d[ -]?){13,19}\b/, // cartão
  /\bsenha\b/i,
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ
];

export function isSensitiveMemory(value: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

export async function listMemories(scope: CompanyScope, contactId: string) {
  return scope.db.contactMemory.findMany({ where: { contactId }, orderBy: { updatedAt: 'desc' } });
}

export async function upsertMemory(
  scope: CompanyScope,
  contactId: string,
  key: string,
  value: string,
) {
  if (isSensitiveMemory(value))
    throw new ValidationError('Informação sensível não pode ser armazenada como memória.');
  const contact = await scope.db.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  const source = scope.actor.type === 'AI' ? 'AI' : 'USER';
  return scope.db.contactMemory.upsert({
    where: { contactId_key: { contactId, key } },
    create: { companyId: scope.companyId, contactId, key, value, source },
    update: { value, source },
  });
}

export async function deleteMemory(scope: CompanyScope, memoryId: string) {
  const result = await scope.db.contactMemory.deleteMany({ where: { id: memoryId } });
  if (result.count === 0) throw new NotFoundError('Memória não encontrada.');
}

/** Exportação de todos os dados de um contato (portabilidade/LGPD). */
export async function exportContactData(scope: CompanyScope, contactId: string) {
  const contact = await scope.db.contact.findUnique({
    where: { id: contactId },
    include: {
      tags: { include: { tag: { select: { name: true } } } },
      notes: { select: { body: true, createdAt: true, authorType: true } },
      memories: { select: { key: true, value: true, updatedAt: true } },
      leads: {
        select: {
          title: true,
          qualification: true,
          createdAt: true,
          stage: { select: { name: true } },
        },
      },
      appointments: { select: { startAt: true, endAt: true, status: true, notes: true } },
      conversations: {
        select: {
          id: true,
          createdAt: true,
          messages: {
            select: { direction: true, sender: true, type: true, text: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
  if (!contact) throw new NotFoundError('Contato não encontrado.');
  await audit(scope, {
    action: 'contact.exported',
    resourceType: 'Contact',
    resourceId: contactId,
  });
  return { exportedAt: new Date(), contact };
}
