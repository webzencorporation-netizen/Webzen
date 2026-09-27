import type { Prisma } from '@botsaas/database';
import { NotFoundError } from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { toSkipTake, type PaginationQuery } from '../../../lib/http';

export interface ServiceInput {
  name: string;
  description?: string | null;
  category?: string | null;
  priceCents?: number | null;
  priceNote?: string | null;
  priceVisibleToAi?: boolean;
  durationMinutes?: number | null;
  isActive?: boolean;
}

export interface ProductInput extends Omit<ServiceInput, 'durationMinutes'> {
  sku?: string | null;
  trackStock?: boolean;
  stockQuantity?: number | null;
  attributes?: Record<string, string | number | boolean | null> | null;
}

type CatalogQuery = PaginationQuery & { search?: string; active?: boolean; category?: string };

function catalogWhere(query: CatalogQuery) {
  return {
    ...(query.active !== undefined ? { isActive: query.active } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
            { category: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

export async function listServices(scope: CompanyScope, query: CatalogQuery) {
  const where: Prisma.ServiceWhereInput = catalogWhere(query);
  const [total, items] = await Promise.all([
    scope.db.service.count({ where }),
    scope.db.service.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export function createService(scope: CompanyScope, input: ServiceInput) {
  return scope.db.service.create({ data: { companyId: scope.companyId, ...input } });
}

export async function updateService(scope: CompanyScope, id: string, input: Partial<ServiceInput>) {
  if (!(await scope.db.service.findUnique({ where: { id }, select: { id: true } })))
    throw new NotFoundError('Serviço não encontrado.');
  return scope.db.service.update({ where: { id }, data: input });
}

export async function deleteService(scope: CompanyScope, id: string) {
  const result = await scope.db.service.deleteMany({ where: { id } });
  if (result.count === 0) throw new NotFoundError('Serviço não encontrado.');
}

export async function listProducts(scope: CompanyScope, query: CatalogQuery) {
  const where: Prisma.ProductWhereInput = catalogWhere(query);
  const [total, items] = await Promise.all([
    scope.db.product.count({ where }),
    scope.db.product.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export function createProduct(scope: CompanyScope, input: ProductInput) {
  const { attributes, ...rest } = input;
  return scope.db.product.create({
    data: {
      companyId: scope.companyId,
      ...rest,
      attributes: (attributes ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function updateProduct(scope: CompanyScope, id: string, input: Partial<ProductInput>) {
  if (!(await scope.db.product.findUnique({ where: { id }, select: { id: true } })))
    throw new NotFoundError('Produto não encontrado.');
  const { attributes, ...rest } = input;
  return scope.db.product.update({
    where: { id },
    data: {
      ...rest,
      ...(attributes !== undefined
        ? { attributes: (attributes ?? undefined) as Prisma.InputJsonValue | undefined }
        : {}),
    },
  });
}

export async function deleteProduct(scope: CompanyScope, id: string) {
  const result = await scope.db.product.deleteMany({ where: { id } });
  if (result.count === 0) throw new NotFoundError('Produto não encontrado.');
}
