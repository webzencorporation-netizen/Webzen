import type { KnowledgeEntryType, Prisma } from '@botsaas/database';
import { NotFoundError } from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { toSkipTake, type PaginationQuery } from '../../../lib/http';
import { knowledgeRetriever } from '../../knowledge/retriever';

export interface KnowledgeEntryInput {
  type: KnowledgeEntryType;
  title: string;
  content: string;
  tags?: string[];
  isActive?: boolean;
}

export async function listEntries(
  scope: CompanyScope,
  query: PaginationQuery & {
    search?: string;
    type?: KnowledgeEntryType;
    includeDocuments?: boolean;
  },
) {
  const where: Prisma.KnowledgeEntryWhereInput = {
    ...(query.type ? { type: query.type } : query.includeDocuments ? {} : { documentId: null }),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { content: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    scope.db.knowledgeEntry.count({ where }),
    scope.db.knowledgeEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      ...toSkipTake(query),
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        tags: true,
        isActive: true,
        documentId: true,
        updatedAt: true,
      },
    }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export function createEntry(scope: CompanyScope, input: KnowledgeEntryInput) {
  return scope.db.knowledgeEntry.create({
    data: {
      companyId: scope.companyId,
      type: input.type,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      isActive: input.isActive ?? true,
    },
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      tags: true,
      isActive: true,
      updatedAt: true,
    },
  });
}

export async function updateEntry(
  scope: CompanyScope,
  id: string,
  input: Partial<KnowledgeEntryInput>,
) {
  const exists = await scope.db.knowledgeEntry.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new NotFoundError('Item não encontrado.');
  return scope.db.knowledgeEntry.update({
    where: { id },
    data: input,
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      tags: true,
      isActive: true,
      updatedAt: true,
    },
  });
}

export async function deleteEntry(scope: CompanyScope, id: string) {
  const entry = await scope.db.knowledgeEntry.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!entry) throw new NotFoundError('Item não encontrado.');
  await scope.db.knowledgeEntry.delete({ where: { id } });
  await audit(scope, {
    action: 'knowledge.entry_deleted',
    resourceType: 'KnowledgeEntry',
    resourceId: id,
    metadata: { title: entry.title },
  });
}

/** Testa a recuperação exatamente como o agente faria (útil para ajustar a base). */
export function searchLikeAgent(scope: CompanyScope, query: string) {
  return knowledgeRetriever.search(scope.companyId, query, 5);
}

export function listDocuments(scope: CompanyScope) {
  return scope.db.knowledgeDocument.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      error: true,
      createdAt: true,
      _count: { select: { entries: true } },
    },
  });
}
