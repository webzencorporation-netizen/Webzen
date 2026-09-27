import { getDummyHash, systemDb, verifyPassword } from '@botsaas/database';
import {
  permissionsForRole,
  PLATFORM_PERMISSIONS,
  platformRoleHasPermission,
} from '@botsaas/shared';
import type { AuthContext } from '../../context';

export async function authenticate(email: string, password: string) {
  const user = await systemDb.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    // Mesmo custo de CPU quando o usuário não existe (evita enumeração por tempo de resposta).
    await verifyPassword(await getDummyHash(), password);
    return null;
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid || !user.isActive) return null;
  return user;
}

export async function defaultCompanyFor(userId: string): Promise<string | null> {
  const membership = await systemDb.companyMember.findFirst({
    where: { userId, isActive: true, company: { status: { not: 'CANCELLED' } } },
    orderBy: { createdAt: 'asc' },
    select: { companyId: true },
  });
  return membership?.companyId ?? null;
}

/** Dados do usuário logado para o painel (sem segredos). */
export async function buildMe(auth: AuthContext) {
  const memberships = await systemDb.companyMember.findMany({
    where: { userId: auth.user.id, isActive: true, company: { status: { not: 'CANCELLED' } } },
    include: {
      company: {
        select: { id: true, name: true, status: true, templateKey: true, onboardingDoneAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const supportActive =
    auth.session.supportCompanyId !== null &&
    auth.session.supportExpiresAt !== null &&
    auth.session.supportExpiresAt.getTime() > Date.now() &&
    auth.user.platformRole !== null &&
    platformRoleHasPermission(auth.user.platformRole, 'platform:support_mode');

  let activeCompany: {
    id: string;
    name: string;
    status: string;
    templateKey: string;
    onboardingDone: boolean;
    role: string;
    permissions: string[];
  } | null = null;

  if (supportActive && auth.session.supportCompanyId) {
    const company = await systemDb.company.findUnique({
      where: { id: auth.session.supportCompanyId },
    });
    if (company) {
      activeCompany = {
        id: company.id,
        name: company.name,
        status: company.status,
        templateKey: company.templateKey,
        onboardingDone: company.onboardingDoneAt !== null,
        role: 'COMPANY_ADMIN',
        permissions: permissionsForRole('COMPANY_ADMIN'),
      };
    }
  } else {
    const current = memberships.find(
      (membership) => membership.companyId === auth.session.activeCompanyId,
    );
    if (current) {
      activeCompany = {
        id: current.company.id,
        name: current.company.name,
        status: current.company.status,
        templateKey: current.company.templateKey,
        onboardingDone: current.company.onboardingDoneAt !== null,
        role: current.role,
        permissions: permissionsForRole(current.role),
      };
    }
  }

  const platformRole = auth.user.platformRole;
  return {
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      mustChangePassword: auth.user.mustChangePassword,
    },
    platformRole,
    platformPermissions: platformRole
      ? PLATFORM_PERMISSIONS.filter((permission) =>
          platformRoleHasPermission(platformRole, permission),
        )
      : [],
    memberships: memberships.map((membership) => ({
      companyId: membership.companyId,
      companyName: membership.company.name,
      role: membership.role,
      status: membership.company.status,
    })),
    activeCompany,
    supportMode: supportActive
      ? { companyId: auth.session.supportCompanyId, expiresAt: auth.session.supportExpiresAt }
      : null,
  };
}
