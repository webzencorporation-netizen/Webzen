import { createTenantClient, systemDb } from '@botsaas/database';
import {
  AuthenticationError,
  AuthorizationError,
  permissionsForRole,
  platformRoleHasPermission,
  roleHasPermission,
  type CompanyPermission,
  type PlatformPermission,
} from '@botsaas/shared';
import type { FastifyRequest } from 'fastify';
import type { AuthContext, TenantContext } from '../context';

/** Metadados de cada guard, lidos pelo inventário de endpoints (plugins/route-inventory.ts). */
export type GuardInfo =
  | { kind: 'authenticated' }
  | { kind: 'platform'; permission: PlatformPermission }
  | { kind: 'company'; permission: CompanyPermission | null };

const GUARDS = new WeakMap<object, GuardInfo>();

function markGuard<T extends object>(fn: T, info: GuardInfo): T {
  GUARDS.set(fn, info);
  return fn;
}

export function guardInfo(fn: unknown): GuardInfo | undefined {
  return typeof fn === 'function' ? GUARDS.get(fn) : undefined;
}

/** Papel efetivo no modo suporte (administração da empresa, auditado). */
const SUPPORT_MODE_ROLE = 'COMPANY_ADMIN' as const;

export function requireAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AuthenticationError();
  return request.auth;
}

export function requireTenant(request: FastifyRequest): TenantContext {
  if (!request.tenant) throw new AuthorizationError('Nenhuma empresa selecionada.');
  return request.tenant;
}

/** preHandler: exige usuário autenticado. */
export const authenticated = markGuard(
  async (request: FastifyRequest): Promise<void> => {
    requireAuthContext(request);
  },
  { kind: 'authenticated' },
);

/** preHandler: exige papel de plataforma com a permissão informada. */
export function platform(permission: PlatformPermission) {
  return markGuard(
    async (request: FastifyRequest): Promise<void> => {
      const auth = requireAuthContext(request);
      const role = auth.user.platformRole;
      if (!role || !platformRoleHasPermission(role, permission)) {
        throw new AuthorizationError();
      }
    },
    { kind: 'platform', permission },
  );
}

/**
 * Resolve a empresa ativa a partir da SESSÃO (nunca de parâmetros do cliente) e valida a
 * associação do usuário. Em modo suporte, exige papel de plataforma e prazo válido.
 */
export async function resolveTenantContext(
  request: FastifyRequest,
  auth: AuthContext,
): Promise<TenantContext> {
  const { session, user } = auth;
  const supportActive =
    session.supportCompanyId !== null &&
    session.supportExpiresAt !== null &&
    session.supportExpiresAt.getTime() > Date.now() &&
    user.platformRole !== null &&
    platformRoleHasPermission(user.platformRole, 'platform:support_mode');

  if (supportActive && session.supportCompanyId) {
    const company = await systemDb.company.findUnique({
      where: { id: session.supportCompanyId },
      select: { id: true },
    });
    if (!company) throw new AuthorizationError('Empresa não encontrada.');
    return {
      companyId: company.id,
      db: createTenantClient(company.id),
      actor: { type: 'PLATFORM_ADMIN', userId: user.id, label: `${user.name} (suporte)` },
      role: SUPPORT_MODE_ROLE,
      permissions: new Set(permissionsForRole(SUPPORT_MODE_ROLE)),
      isSupportMode: true,
      requestId: request.id,
      ip: request.ip,
    };
  }

  const companyId = session.activeCompanyId;
  if (!companyId) throw new AuthorizationError('Nenhuma empresa selecionada.');
  const membership = await systemDb.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId: user.id } },
    include: { company: { select: { status: true } } },
  });
  if (!membership || !membership.isActive)
    throw new AuthorizationError('Você não tem acesso a esta empresa.');
  if (membership.company.status === 'SUSPENDED')
    throw new AuthorizationError('Empresa suspensa. Contate o suporte.');
  if (membership.company.status === 'CANCELLED') throw new AuthorizationError('Empresa cancelada.');

  return {
    companyId,
    db: createTenantClient(companyId),
    actor: { type: 'USER', userId: user.id, label: user.name },
    role: membership.role,
    permissions: new Set(permissionsForRole(membership.role)),
    isSupportMode: false,
    requestId: request.id,
    ip: request.ip,
  };
}

/** preHandler: carrega o contexto da empresa e (opcionalmente) exige uma permissão. */
export function company(permission?: CompanyPermission) {
  return markGuard(
    async (request: FastifyRequest): Promise<void> => {
      const auth = requireAuthContext(request);
      const tenant = request.tenant ?? (await resolveTenantContext(request, auth));
      request.tenant = tenant;
      if (permission && !tenant.permissions.has(permission)) {
        throw new AuthorizationError();
      }
    },
    { kind: 'company', permission: permission ?? null },
  );
}

export function hasPermission(tenant: TenantContext, permission: CompanyPermission): boolean {
  return (
    tenant.role !== null &&
    (tenant.permissions.has(permission) || roleHasPermission(tenant.role, permission))
  );
}
