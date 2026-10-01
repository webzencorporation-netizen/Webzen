import type { CompanyRole } from '@botsaas/database';
import {
  AuthorizationError,
  canAssignRole,
  COMPANY_ROLE_LABELS,
  ConflictError,
  NotFoundError,
  RateLimitError,
} from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { getOwnCompany } from '../../../lib/company-record';
import { randomToken, sha256 } from '../../../lib/crypto';
import { queueEmail } from '../../email/service';
import { emailTemplates } from '../../email/templates';
import { assertWithinLimit } from '../../usage/limits';

export const INVITATION_TTL_DAYS = 7;
const RESEND_COOLDOWN_MS = 60_000;

function actorRole(scope: CompanyScope): CompanyRole {
  if (!scope.role) throw new AuthorizationError();
  return scope.role;
}

export function isPending(invitation: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): boolean {
  return invitation.acceptedAt === null && invitation.revokedAt === null;
}

async function sendInvitationEmail(
  scope: CompanyScope,
  invitation: { email: string; role: CompanyRole },
  token: string,
): Promise<void> {
  const company = await getOwnCompany(scope);
  const { env } = scope.container;
  await queueEmail(scope.container, {
    to: invitation.email,
    template: 'teamInvite',
    email: emailTemplates.teamInvite({
      inviterName: scope.actor.label ?? 'Um administrador',
      companyName: company.name,
      roleLabel: COMPANY_ROLE_LABELS[invitation.role].toLowerCase(),
      url: `${env.APP_URL}/invite?token=${encodeURIComponent(token)}`,
      expiresInDays: INVITATION_TTL_DAYS,
    }),
  });
}

export async function listInvitations(scope: CompanyScope, now: Date = new Date()) {
  const invitations = await scope.db.invitation.findMany({
    where: { acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      lastSentAt: true,
      createdAt: true,
    },
  });
  return invitations.map((invitation) => ({
    ...invitation,
    expired: invitation.expiresAt.getTime() <= now.getTime(),
  }));
}

/**
 * Convida por e-mail. Convites pendentes contam no limite de usuários do plano (senão daria
 * para convidar além do limite e aceitar todos depois). Reconvidar o mesmo e-mail substitui
 * o convite anterior.
 */
export async function createInvitation(
  scope: CompanyScope,
  input: { email: string; role: CompanyRole },
  now: Date = new Date(),
) {
  if (!canAssignRole(actorRole(scope), input.role))
    throw new AuthorizationError('Você não pode atribuir este papel.');
  const email = input.email.trim().toLowerCase();
  const member = await scope.db.companyMember.findFirst({
    where: { isActive: true, user: { email } },
    select: { id: true },
  });
  if (member) throw new ConflictError('Este e-mail já faz parte da equipe.');

  const pending = await scope.db.invitation.count({
    where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now }, email: { not: email } },
  });
  await assertWithinLimit(scope, 'USERS', pending + 1);

  const token = randomToken(32);
  const invitation = await scope.db.invitation.create({
    data: {
      companyId: scope.companyId,
      email,
      role: input.role,
      tokenHash: sha256(token),
      invitedById: scope.actor.userId ?? null,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 3600_000),
      lastSentAt: now,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  // Reconvidar o mesmo e-mail invalida o link anterior.
  await scope.db.invitation.updateMany({
    where: { email, acceptedAt: null, revokedAt: null, id: { not: invitation.id } },
    data: { revokedAt: now },
  });
  await sendInvitationEmail(scope, invitation, token);
  await audit(scope, {
    action: 'invitation.created',
    resourceType: 'Invitation',
    resourceId: invitation.id,
    metadata: { email, role: input.role },
  });
  return invitation;
}

/** Reenvia com um token novo (o link anterior deixa de valer) e prazo renovado. */
export async function resendInvitation(scope: CompanyScope, id: string, now: Date = new Date()) {
  const invitation = await scope.db.invitation.findUnique({ where: { id } });
  if (!invitation || !isPending(invitation)) throw new NotFoundError('Convite não encontrado.');
  if (!canAssignRole(actorRole(scope), invitation.role))
    throw new AuthorizationError('Você não pode gerenciar este convite.');
  if (now.getTime() - invitation.lastSentAt.getTime() < RESEND_COOLDOWN_MS)
    throw new RateLimitError('Aguarde um minuto antes de reenviar o convite.');
  const token = randomToken(32);
  await scope.db.invitation.update({
    where: { id },
    data: {
      tokenHash: sha256(token),
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 3600_000),
    },
  });
  await sendInvitationEmail(scope, invitation, token);
  await audit(scope, { action: 'invitation.resent', resourceType: 'Invitation', resourceId: id });
}

export async function revokeInvitation(scope: CompanyScope, id: string, now: Date = new Date()) {
  const invitation = await scope.db.invitation.findUnique({ where: { id } });
  if (!invitation || !isPending(invitation)) throw new NotFoundError('Convite não encontrado.');
  if (!canAssignRole(actorRole(scope), invitation.role))
    throw new AuthorizationError('Você não pode gerenciar este convite.');
  await scope.db.invitation.update({ where: { id }, data: { revokedAt: now } });
  await audit(scope, { action: 'invitation.revoked', resourceType: 'Invitation', resourceId: id });
}
