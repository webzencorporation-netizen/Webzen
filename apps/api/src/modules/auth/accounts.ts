import { hashPassword, isUniqueConstraintError, systemDb } from '@botsaas/database';
import {
  NotFoundError,
  ValidationError,
  type BillingInterval,
  type BusinessTemplateKey,
} from '@botsaas/shared';
import type { AppContainer } from '../../container';
import { auditPlatform } from '../../lib/audit';
import { queueEmail } from '../email/service';
import { emailTemplates } from '../email/templates';
import { createCompany } from '../platform/companies.service';
import { AUTH_TOKEN_TTL_MS, consumeAuthToken, issueAuthToken } from './tokens';
import { destroyUserSessions } from './sessions';

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  companyName: string;
  templateKey: BusinessTemplateKey;
  timezone: string;
  planKey?: string | null;
  interval: BillingInterval;
  referralCode?: string | null;
}

function link(container: AppContainer, path: string, token: string): string {
  return `${container.env.APP_URL}${path}?token=${encodeURIComponent(token)}`;
}

async function sendVerification(
  container: AppContainer,
  user: { id: string; email: string; name: string },
): Promise<void> {
  const token = await issueAuthToken(user, 'EMAIL_VERIFICATION');
  await queueEmail(container, {
    to: user.email,
    template: 'verifyEmail',
    email: emailTemplates.verifyEmail({
      name: user.name,
      url: link(container, '/verify-email', token),
      expiresInHours: AUTH_TOKEN_TTL_MS.EMAIL_VERIFICATION / 3600_000,
    }),
  });
}

async function sendPasswordReset(
  container: AppContainer,
  user: { id: string; email: string; name: string },
  reason: 'requested' | 'signup_attempt' = 'requested',
): Promise<void> {
  const token = await issueAuthToken(user, 'PASSWORD_RESET');
  const url = link(container, '/reset-password', token);
  const expiresInMinutes = AUTH_TOKEN_TTL_MS.PASSWORD_RESET / 60_000;
  await queueEmail(container, {
    to: user.email,
    template: reason === 'requested' ? 'resetPassword' : 'accountExists',
    email:
      reason === 'requested'
        ? emailTemplates.resetPassword({ name: user.name, url, expiresInMinutes })
        : emailTemplates.accountExists({
            name: user.name,
            url,
            loginUrl: `${container.env.APP_URL}/login`,
            expiresInMinutes,
          }),
  });
}

/** Plano escolhido na página de preços: só planos ativos e públicos (nunca preço do navegador). */
async function resolveSignupPlan(planKey: string | null | undefined): Promise<string> {
  if (planKey) {
    const plan = await systemDb.plan.findFirst({
      where: { key: planKey, isActive: true, isPublic: true },
      select: { key: true },
    });
    if (!plan) throw new NotFoundError('Plano não encontrado.');
    return plan.key;
  }
  const first = await systemDb.plan.findFirst({
    where: { isActive: true, isPublic: true },
    orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
    select: { key: true },
  });
  if (!first) throw new NotFoundError('Nenhum plano disponível.');
  return first.key;
}

/**
 * Cadastro self-service: cria a pessoa (e-mail ainda não confirmado), a empresa e uma
 * assinatura INCOMPLETE no plano escolhido; o pagamento vem depois, no checkout.
 *
 * Resposta idêntica para e-mail novo ou já cadastrado (não revela quem tem conta): quando
 * o e-mail já existe, o dono do endereço recebe um aviso com o caminho para entrar ou
 * redefinir a senha, e nada é criado.
 */
export async function signup(
  container: AppContainer,
  input: SignupInput,
  meta: { ip?: string },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const planKey = await resolveSignupPlan(input.planKey);
  const existing = await systemDb.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, isActive: true },
  });
  if (existing) {
    // Mesmo custo de CPU do caminho de criação (o hash da senha), para o tempo de resposta
    // não denunciar e-mails cadastrados.
    await hashPassword(input.password);
    if (existing.isActive) await sendPasswordReset(container, existing, 'signup_attempt');
    return;
  }

  let created: Awaited<ReturnType<typeof createCompany>>;
  try {
    created = await createCompany(
      container,
      { type: 'SYSTEM', label: 'cadastro público' },
      {
        name: input.companyName,
        templateKey: input.templateKey,
        timezone: input.timezone,
        email,
        planKey,
        owner: { email, name: input.name, password: input.password },
        ownerEmailVerified: false,
        subscriptionStatus: 'INCOMPLETE',
        billingInterval: input.interval,
        signupReferralCode: input.referralCode ?? null,
      },
    );
  } catch (error) {
    // Cadastro simultâneo com o mesmo e-mail: o outro pedido venceu; mesma resposta.
    if (isUniqueConstraintError(error)) return;
    throw error;
  }
  const owner = await systemDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  await auditPlatform(
    { type: 'USER', userId: owner.id, label: owner.name },
    {
      companyId: created.company.id,
      action: 'account.signup',
      resourceType: 'Company',
      resourceId: created.company.id,
      metadata: { planKey, interval: input.interval },
      ip: meta.ip,
    },
  );
  await sendVerification(container, owner);
}

/** Reenvio do link de confirmação. Silencioso para e-mails inexistentes ou já confirmados. */
export async function resendVerification(container: AppContainer, rawEmail: string): Promise<void> {
  const user = await systemDb.user.findUnique({
    where: { email: rawEmail.trim().toLowerCase() },
    select: { id: true, email: true, name: true, isActive: true, emailVerifiedAt: true },
  });
  if (!user || !user.isActive || user.emailVerifiedAt) return;
  await sendVerification(container, user);
}

/**
 * Confirma o e-mail. No primeiro aceite, se a plataforma oferece teste grátis e a pessoa
 * ainda não usou o dela, a assinatura pendente vira TRIALING (um teste por pessoa).
 */
export async function verifyEmail(
  container: AppContainer,
  rawToken: string,
  now: Date = new Date(),
): Promise<{ userId: string }> {
  const { userId } = await consumeAuthToken(rawToken, 'EMAIL_VERIFICATION', now);
  const user = await systemDb.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true, trialUsedAt: true },
  });
  if (user.emailVerifiedAt) return { userId };

  const membership = await systemDb.companyMember.findFirst({
    where: { userId, role: 'COMPANY_OWNER', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { company: { select: { id: true, name: true, subscription: true } } },
  });
  const trialDays = container.env.BILLING_TRIAL_DAYS;
  const subscription = membership?.company.subscription ?? null;
  const startTrial =
    trialDays > 0 &&
    user.trialUsedAt === null &&
    subscription !== null &&
    subscription.status === 'INCOMPLETE' &&
    subscription.externalId === null;

  await systemDb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: now, ...(startTrial ? { trialUsedAt: now } : {}) },
    });
    if (startTrial && subscription) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'TRIALING',
          trialEndsAt: new Date(now.getTime() + trialDays * 24 * 3600_000),
          currentPeriodStart: now,
        },
      });
    }
  });
  await auditPlatform(
    { type: 'USER', userId, label: user.name },
    {
      companyId: membership?.company.id ?? null,
      action: 'account.email_verified',
      resourceType: 'User',
      resourceId: userId,
      metadata: startTrial ? { trialDays } : {},
    },
  );
  if (membership) {
    await queueEmail(container, {
      to: user.email,
      template: 'welcome',
      email: emailTemplates.welcome({
        name: user.name,
        companyName: membership.company.name,
        url: `${container.env.APP_URL}/app/onboarding`,
      }),
    });
  }
  return { userId };
}

/** "Esqueci a senha": silencioso para e-mails inexistentes ou contas desativadas. */
export async function forgotPassword(container: AppContainer, rawEmail: string): Promise<void> {
  const user = await systemDb.user.findUnique({
    where: { email: rawEmail.trim().toLowerCase() },
    select: { id: true, email: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) return;
  await sendPasswordReset(container, user);
}

/**
 * Nova senha pelo link do e-mail: troca o hash, confirma o e-mail (a pessoa provou acesso
 * à caixa), encerra TODAS as sessões e avisa por e-mail.
 */
export async function resetPassword(
  container: AppContainer,
  rawToken: string,
  newPassword: string,
  meta: { ip?: string },
): Promise<void> {
  const { userId } = await consumeAuthToken(rawToken, 'PASSWORD_RESET');
  const user = await systemDb.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (newPassword.trim().length === 0) throw new ValidationError('Informe a nova senha.');
  await systemDb.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
    },
  });
  await destroyUserSessions(userId);
  await auditPlatform(
    { type: 'USER', userId, label: user.name },
    { action: 'user.password_reset', resourceType: 'User', resourceId: userId, ip: meta.ip },
  );
  await queueEmail(container, {
    to: user.email,
    template: 'passwordChanged',
    email: emailTemplates.passwordChanged({ name: user.name }),
  });
}
