import { randomBytes } from 'node:crypto';
import { hashPassword, type CompanyRole } from '@botsaas/database';
import {
  AuthorizationError,
  canAssignRole,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { assertWithinLimit } from '../../usage/limits';
import { createCompanyUser, findUserByEmail } from '../../users/service';

export async function listMembers(scope: CompanyScope) {
  const members = await scope.db.companyMember.findMany({
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return members.map((member) => ({
    id: member.id,
    role: member.role,
    isActive: member.isActive,
    createdAt: member.createdAt,
    user: member.user,
  }));
}

function actorRole(scope: CompanyScope): CompanyRole {
  if (!scope.role) throw new AuthorizationError();
  return scope.role;
}

export async function addMember(
  scope: CompanyScope,
  input: { email: string; name: string; role: CompanyRole; password?: string | null },
) {
  if (!canAssignRole(actorRole(scope), input.role))
    throw new AuthorizationError('Você não pode atribuir este papel.');
  await assertWithinLimit(scope, 'USERS');

  const email = input.email.trim().toLowerCase();
  let user = await findUserByEmail(email);
  let temporaryPassword: string | null = null;
  if (!user) {
    temporaryPassword = input.password ? null : randomBytes(9).toString('base64url');
    user = await createCompanyUser({
      email,
      name: input.name,
      passwordHash: await hashPassword(input.password ?? temporaryPassword ?? ''),
      mustChangePassword: !input.password,
    });
  }
  const existing = await scope.db.companyMember.findFirst({ where: { userId: user.id } });
  if (existing?.isActive) throw new ConflictError('Este usuário já faz parte da equipe.');
  const member = existing
    ? await scope.db.companyMember.update({
        where: { id: existing.id },
        data: { isActive: true, role: input.role },
      })
    : await scope.db.companyMember.create({
        data: {
          companyId: scope.companyId,
          userId: user.id,
          role: input.role,
          invitedById: scope.actor.userId ?? null,
        },
      });
  await audit(scope, {
    action: 'member.invited',
    resourceType: 'CompanyMember',
    resourceId: member.id,
    metadata: { email, role: input.role },
  });
  return { memberId: member.id, temporaryPassword };
}

async function assertNotLastOwner(scope: CompanyScope, memberId: string) {
  const owners = await scope.db.companyMember.count({
    where: { role: 'COMPANY_OWNER', isActive: true, id: { not: memberId } },
  });
  if (owners === 0)
    throw new ValidationError('A empresa precisa de pelo menos um proprietário ativo.');
}

export async function updateMember(
  scope: CompanyScope,
  memberId: string,
  input: { role?: CompanyRole; isActive?: boolean },
) {
  const member = await scope.db.companyMember.findUnique({ where: { id: memberId } });
  if (!member) throw new NotFoundError('Membro não encontrado.');
  const role = actorRole(scope);
  if (member.userId === scope.actor.userId)
    throw new ValidationError('Você não pode alterar o próprio acesso.');
  if (!canAssignRole(role, member.role) || (input.role && !canAssignRole(role, input.role))) {
    throw new AuthorizationError('Você não pode gerenciar este membro.');
  }
  if (member.role === 'COMPANY_OWNER' && (input.role !== undefined || input.isActive === false)) {
    await assertNotLastOwner(scope, member.id);
  }
  const updated = await scope.db.companyMember.update({ where: { id: memberId }, data: input });
  if (input.role && input.role !== member.role) {
    await audit(scope, {
      action: 'member.role_changed',
      resourceType: 'CompanyMember',
      resourceId: memberId,
      metadata: { from: member.role, to: input.role },
    });
  }
  if (input.isActive !== undefined && input.isActive !== member.isActive) {
    await audit(scope, {
      action: input.isActive ? 'member.reactivated' : 'member.deactivated',
      resourceType: 'CompanyMember',
      resourceId: memberId,
    });
  }
  return updated;
}

export async function removeMember(scope: CompanyScope, memberId: string) {
  const member = await scope.db.companyMember.findUnique({ where: { id: memberId } });
  if (!member) throw new NotFoundError('Membro não encontrado.');
  if (member.userId === scope.actor.userId)
    throw new ValidationError('Você não pode remover a si mesmo.');
  if (!canAssignRole(actorRole(scope), member.role))
    throw new AuthorizationError('Você não pode remover este membro.');
  if (member.role === 'COMPANY_OWNER') await assertNotLastOwner(scope, member.id);
  await scope.db.companyMember.delete({ where: { id: memberId } });
  await audit(scope, {
    action: 'member.removed',
    resourceType: 'CompanyMember',
    resourceId: memberId,
    metadata: { role: member.role },
  });
}
