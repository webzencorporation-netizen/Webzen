import type { CompanyRole, PlatformRole } from './enums';

/**
 * RBAC por permissões granulares. Rotas pedem permissões, nunca papéis diretamente,
 * para que papéis possam evoluir (ou virar customizáveis) sem mexer nas rotas.
 */
export const COMPANY_PERMISSIONS = [
  'company:read',
  'company:update',
  'team:read',
  'team:manage',
  'conversations:read',
  'conversations:reply',
  'conversations:assign',
  'conversations:mode',
  'conversations:delete',
  'contacts:read',
  'contacts:write',
  'contacts:delete',
  'contacts:export',
  'crm:read',
  'crm:write',
  'crm:configure',
  'calendar:read',
  'calendar:write',
  'catalog:read',
  'catalog:write',
  'knowledge:read',
  'knowledge:write',
  'ai:read',
  'ai:configure',
  'ai:test',
  'ai:prompt_preview',
  'ai:emergency_stop',
  'automations:read',
  'automations:write',
  'integrations:read',
  'integrations:manage',
  'reports:read',
  'usage:read',
  'audit:read',
  'settings:manage',
  'privacy:manage',
  'billing:read',
  'billing:manage',
] as const;

export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

const READ_ONLY: CompanyPermission[] = [
  'company:read',
  'conversations:read',
  'contacts:read',
  'crm:read',
  'calendar:read',
  'catalog:read',
  'knowledge:read',
  'reports:read',
];

const ATTENDANT: CompanyPermission[] = [
  ...READ_ONLY,
  'conversations:reply',
  'conversations:mode',
  'contacts:write',
  'crm:write',
  'calendar:write',
];

const MANAGER: CompanyPermission[] = [
  ...ATTENDANT,
  'team:read',
  'conversations:assign',
  'contacts:export',
  'crm:configure',
  'catalog:write',
  'knowledge:write',
  'ai:read',
  'ai:test',
  'automations:read',
  'integrations:read',
  'usage:read',
];

const COMPANY_ADMIN: CompanyPermission[] = COMPANY_PERMISSIONS.filter(
  // Somente o dono pode excluir dados em massa / gerir privacidade e contratar, trocar ou
  // cancelar o plano (decisões financeiras). O administrador vê a assinatura e as faturas.
  (permission) => permission !== 'privacy:manage' && permission !== 'billing:manage',
);

export const ROLE_PERMISSIONS: Record<CompanyRole, ReadonlySet<CompanyPermission>> = {
  COMPANY_OWNER: new Set(COMPANY_PERMISSIONS),
  COMPANY_ADMIN: new Set(COMPANY_ADMIN),
  MANAGER: new Set(MANAGER),
  ATTENDANT: new Set(ATTENDANT),
  VIEWER: new Set(READ_ONLY),
};

export function roleHasPermission(role: CompanyRole, permission: CompanyPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsForRole(role: CompanyRole): CompanyPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Hierarquia para decidir quem pode gerir quem (convidar, alterar papel, remover). */
export const COMPANY_ROLE_RANK: Record<CompanyRole, number> = {
  COMPANY_OWNER: 50,
  COMPANY_ADMIN: 40,
  MANAGER: 30,
  ATTENDANT: 20,
  VIEWER: 10,
};

/** Um usuário só pode atribuir papéis estritamente abaixo do seu (o dono pode atribuir qualquer um). */
export function canAssignRole(actor: CompanyRole, target: CompanyRole): boolean {
  if (actor === 'COMPANY_OWNER') return true;
  return COMPANY_ROLE_RANK[actor] > COMPANY_ROLE_RANK[target];
}

export const PLATFORM_PERMISSIONS = [
  'platform:companies:read',
  'platform:companies:write',
  'platform:plans:write',
  'platform:usage:read',
  'platform:support_mode',
  'platform:admins:manage',
  'platform:pricing:write',
  'platform:health:read',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<PlatformPermission>> = {
  PLATFORM_OWNER: new Set(PLATFORM_PERMISSIONS),
  PLATFORM_ADMIN: new Set(
    PLATFORM_PERMISSIONS.filter((permission) => permission !== 'platform:admins:manage'),
  ),
};

export function platformRoleHasPermission(
  role: PlatformRole,
  permission: PlatformPermission,
): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role].has(permission);
}

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  COMPANY_OWNER: 'Proprietário',
  COMPANY_ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  ATTENDANT: 'Atendente',
  VIEWER: 'Somente leitura',
};
