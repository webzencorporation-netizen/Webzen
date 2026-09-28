import { describe, expect, it } from 'vitest';
import { canAssignRole, platformRoleHasPermission, roleHasPermission } from '../src/permissions';

describe('permissões e hierarquia', () => {
  it('reserva gestão de privacidade ao dono da empresa', () => {
    expect(roleHasPermission('COMPANY_OWNER', 'privacy:manage')).toBe(true);
    expect(roleHasPermission('COMPANY_ADMIN', 'privacy:manage')).toBe(false);
    expect(roleHasPermission('COMPANY_ADMIN', 'team:manage')).toBe(true);
  });

  it('permite leitura ao viewer sem conceder resposta ou escrita', () => {
    expect(roleHasPermission('VIEWER', 'conversations:read')).toBe(true);
    expect(roleHasPermission('VIEWER', 'conversations:reply')).toBe(false);
    expect(roleHasPermission('VIEWER', 'contacts:write')).toBe(false);
  });

  it('atendente responde e transfere sem administrar integração ou agente', () => {
    expect(roleHasPermission('ATTENDANT', 'conversations:reply')).toBe(true);
    expect(roleHasPermission('ATTENDANT', 'conversations:mode')).toBe(true);
    expect(roleHasPermission('ATTENDANT', 'integrations:manage')).toBe(false);
    expect(roleHasPermission('ATTENDANT', 'ai:configure')).toBe(false);
  });

  it('gerente testa o agente sem alterar suas regras', () => {
    expect(roleHasPermission('MANAGER', 'ai:test')).toBe(true);
    expect(roleHasPermission('MANAGER', 'ai:configure')).toBe(false);
  });

  it('impede atribuição de papel igual ou superior por quem não é dono', () => {
    expect(canAssignRole('COMPANY_ADMIN', 'COMPANY_OWNER')).toBe(false);
    expect(canAssignRole('COMPANY_ADMIN', 'COMPANY_ADMIN')).toBe(false);
    expect(canAssignRole('COMPANY_ADMIN', 'MANAGER')).toBe(true);
    expect(canAssignRole('VIEWER', 'VIEWER')).toBe(false);
    expect(canAssignRole('COMPANY_OWNER', 'COMPANY_OWNER')).toBe(true);
  });

  it('admin da plataforma pode operar empresas sem gerir administradores', () => {
    expect(platformRoleHasPermission('PLATFORM_ADMIN', 'platform:companies:write')).toBe(true);
    expect(platformRoleHasPermission('PLATFORM_ADMIN', 'platform:admins:manage')).toBe(false);
    expect(platformRoleHasPermission('PLATFORM_OWNER', 'platform:admins:manage')).toBe(true);
  });
});
