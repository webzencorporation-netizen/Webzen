export { Prisma, PrismaClient } from './generated/prisma/client';
export * from './generated/prisma/enums';
export type * from './generated/prisma/models';
export { createPrismaClient, disconnectSystemDb, getSystemDb, systemDb, type SystemDb } from './client';
export {
  applyTenantScope,
  createTenantClient,
  TENANT_SCOPED_MODELS,
  TenantScopeViolation,
  type TenantDb,
} from './tenant';
export { decimalToNumber, isUniqueConstraintError, isNotFoundError } from './utils';
