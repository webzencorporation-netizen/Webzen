import { hashPassword, systemDb } from '@botsaas/database';
import {
  AuthenticationError,
  AuthorizationError,
  COMPANY_ROLE_LABELS,
  ConflictError,
  ValidationError,
} from '@botsaas/shared';
import type { AppContainer } from '../../container';
import type { AuthContext } from '../../context';
import { auditPlatform } from '../../lib/audit';
import { sha256 } from '../../lib/crypto';
import { systemScope } from '../../lib/scope';
import { isPending } from '../company/team/invitations';
import { assertWithinLimit } from '../usage/limits';

/**
 * Lado público dos convites: quem tem o link vê o convite e o aceita. Não há empresa na
 * sessão para dar escopo — o convite é localizado pelo hash do token, e a empresa e o papel
 * saem dele, nunca da requisição.
 */
const INVALID_INVITE = 'Convite inválido, expirado ou já utilizado.';

async function findValidInvitation(rawToken: string, now: Date) {
  if (!rawToken || rawToken.length > 200) throw new ValidationError(INVALID_INVITE);
  const invitation = await systemDb.invitation.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { company: { select: { id: true, name: true, status: true } } },
  });
  if (
    !invitation ||
    !isPending(invitation) ||
    invitation.expiresAt.getTime() <= now.getTime() ||
    invitation.company.status === 'CANCELLED'
  ) {
    throw new ValidationError(INVALID_INVITE);
  }
  return invitation;
}

/** Dados para a tela de aceite (só para quem tem o link). */
export async function previewInvitation(rawToken: string, now: Date = new Date()) {
  const invitation = await findValidInvitation(rawToken, now);
  const user = await systemDb.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  return {
    companyName: invitation.company.name,
    email: invitation.email,
    role: invitation.role,
    roleLabel: COMPANY_ROLE_LABELS[invitation.role],
    hasAccount: user !== null,
  };
}

/**
 * Aceita o convite. A empresa e o papel vêm SÓ do convite (nunca do corpo da requisição).
 * - E-mail com conta: a pessoa precisa estar logada nessa conta.
 * - E-mail sem conta: cria a conta (e-mail já confirmado, pois o link chegou nele).
 * O convite é marcado como aceito de forma atômica: o mesmo link não serve duas vezes.
 */
export async function acceptInvitation(
  container: AppContainer,
  rawToken: string,
  input: { auth: AuthContext | null; name?: string; password?: string; ip?: string },
  now: Date = new Date(),
): Promise<{ userId: string; companyId: string }> {
  const invitation = await findValidInvitation(rawToken, now);
  const existing = await systemDb.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, name: true, isActive: true },
  });
  if (existing) {
    if (!input.auth || input.auth.user.id !== existing.id) {
      throw new AuthenticationError(
        `Entre com a conta ${invitation.email} para aceitar o convite.`,
      );
    }
    if (!existing.isActive) throw new AuthorizationError('Conta desativada.');
  } else if (!input.name || !input.password) {
    throw new ValidationError('Informe seu nome e uma senha para criar a conta.');
  }
  // O plano pode ter mudado desde o convite (downgrade): o limite vale no aceite também.
  await assertWithinLimit(systemScope(container, invitation.companyId), 'USERS');
  const passwordHash = existing ? null : await hashPassword(input.password ?? '');

  const result = await systemDb.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) throw new ValidationError(INVALID_INVITE);
    const user =
      existing ??
      (await tx.user.create({
        data: {
          email: invitation.email,
          name: (input.name ?? '').trim(),
          passwordHash: passwordHash ?? '',
          emailVerifiedAt: now,
        },
        select: { id: true, name: true },
      }));
    const membership = await tx.companyMember.findUnique({
      where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
    });
    if (membership?.isActive) throw new ConflictError('Você já faz parte desta equipe.');
    if (membership) {
      await tx.companyMember.update({
        where: { id: membership.id },
        data: { isActive: true, role: invitation.role, invitedById: invitation.invitedById },
      });
    } else {
      await tx.companyMember.create({
        data: {
          companyId: invitation.companyId,
          userId: user.id,
          role: invitation.role,
          invitedById: invitation.invitedById,
        },
      });
    }
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedUserId: user.id },
    });
    await tx.notification.create({
      data: {
        companyId: invitation.companyId,
        type: 'SYSTEM',
        title: `${user.name} entrou na equipe`,
        body: `Convite aceito como ${COMPANY_ROLE_LABELS[invitation.role].toLowerCase()}.`,
        link: '/app/team',
      },
    });
    return { userId: user.id, userName: user.name };
  });
  await auditPlatform(
    { type: 'USER', userId: result.userId, label: result.userName },
    {
      companyId: invitation.companyId,
      action: 'invitation.accepted',
      resourceType: 'Invitation',
      resourceId: invitation.id,
      metadata: { role: invitation.role, newAccount: existing === null },
      ip: input.ip,
    },
  );
  return { userId: result.userId, companyId: invitation.companyId };
}
