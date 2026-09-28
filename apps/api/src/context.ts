import type { Prisma, TenantDb } from '@botsaas/database';
import type { AppContainer } from './container';
import type { CompanyPermission, CompanyRole, PlatformRole } from '@botsaas/shared';

export type ActorKind = 'USER' | 'PLATFORM_ADMIN' | 'AI' | 'CONTACT' | 'SYSTEM';

/** Quem está executando uma ação (usado em auditoria, notas e mensagens). */
export interface Actor {
  type: ActorKind;
  userId?: string;
  label?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole | null;
  mustChangePassword: boolean;
}

export interface AuthSession {
  id: string;
  activeCompanyId: string | null;
  supportCompanyId: string | null;
  supportExpiresAt: Date | null;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
}

/**
 * Contexto de uma operação dentro de UMA empresa. Todo serviço de domínio recebe este objeto;
 * `db` já está preso ao `companyId` e não enxerga outras empresas.
 */
export interface TenantContext {
  companyId: string;
  db: TenantDb;
  actor: Actor;
  role: CompanyRole | null;
  permissions: ReadonlySet<CompanyPermission>;
  isSupportMode: boolean;
  requestId?: string;
  ip?: string;
}

/** Contexto completo passado aos serviços de domínio: empresa + infraestrutura. */
export interface CompanyScope extends TenantContext {
  container: AppContainer;
}

/** Operações de domínio também aceitam o client com escopo dentro de uma transação. */
export type CompanyDataScope = Omit<CompanyScope, 'db'> & {
  db: Pick<TenantDb, keyof Prisma.TransactionClient>;
};
