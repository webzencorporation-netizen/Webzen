import { systemDb, type Prisma } from '@botsaas/database';
import type { TenantContext } from '../context';

/**
 * Acesso ao registro `Company` da PRÓPRIA empresa do escopo. O modelo Company não tem
 * `companyId` (ele É a empresa), então o client com escopo não o cobre; este helper
 * garante `where: { id: scope.companyId }` por construção.
 */
export function getOwnCompany(scope: Pick<TenantContext, 'companyId'>) {
  return systemDb.company.findUniqueOrThrow({ where: { id: scope.companyId } });
}

export function updateOwnCompany(
  scope: Pick<TenantContext, 'companyId'>,
  data: Prisma.CompanyUpdateInput,
) {
  return systemDb.company.update({ where: { id: scope.companyId }, data });
}
