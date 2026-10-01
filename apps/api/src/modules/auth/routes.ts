import { hashPassword, PASSWORD_MIN_LENGTH, systemDb, verifyPassword } from '@botsaas/database';
import {
  AuthenticationError,
  AuthorizationError,
  BILLING_INTERVALS,
  BUSINESS_TEMPLATE_KEYS,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@botsaas/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticated, requireAuthContext } from '../../plugins/guards';
import { sessionCookieOptions } from '../../plugins/auth';
import { auditPlatform } from '../../lib/audit';
import { sha256 } from '../../lib/crypto';
import { idParamSchema } from '../../lib/http';
import { acceptInvitation, previewInvitation } from './invitations';
import { forgotPassword, resendVerification, resetPassword, signup, verifyEmail } from './accounts';
import { authenticate, buildMe, defaultCompanyFor } from './service';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  listUserSessions,
  loadSession,
  SESSION_COOKIE,
} from './sessions';

// Normaliza antes de validar: os limites por conta e a busca usam o mesmo e-mail canônico.
const emailSchema = z.string().trim().toLowerCase().max(200).pipe(z.email());
const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);
const tokenSchema = z.string().min(20).max(200);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: newPasswordSchema,
  companyName: z.string().trim().min(2).max(120),
  templateKey: z.enum(BUSINESS_TEMPLATE_KEYS).default('GENERAL'),
  planKey: z
    .string()
    .regex(/^[A-Z0-9_]{2,30}$/)
    .nullish(),
  interval: z.enum(BILLING_INTERVALS).default('MONTHLY'),
  referralCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,40}$/)
    .nullish(),
  acceptTerms: z.literal(true, { error: 'É preciso aceitar os termos de uso.' }),
});

/** Janela do limite de tentativas por conta. */
const ACCOUNT_WINDOW = '15 minutes';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { container } = app;
  const { env } = container;
  const secureCookie = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
  // Por conta, de qualquer IP: o limite por IP sozinho não segura força bruta distribuída.
  // Conta toda tentativa (existente ou não), então não revela quais e-mails têm cadastro.
  const accountLimiter = app.createRateLimit({
    max: env.LOGIN_ACCOUNT_MAX_ATTEMPTS,
    timeWindow: ACCOUNT_WINDOW,
    keyGenerator: (request) => `login-account:${sha256((request.body as { email: string }).email)}`,
  });
  // Rotas que disparam e-mail: limite por IP (config da rota) e por endereço de destino,
  // para ninguém usar o WebZen para encher a caixa de outra pessoa.
  const emailLimiter = app.createRateLimit({
    max: 5,
    timeWindow: '1 hour',
    keyGenerator: (request) => `account-email:${sha256((request.body as { email: string }).email)}`,
  });
  const emailRouteLimit = {
    rateLimit: { max: env.ACCOUNT_EMAIL_RATE_LIMIT_PER_HOUR, timeWindow: '1 hour' },
  };
  async function assertEmailQuota(request: FastifyRequest): Promise<void> {
    const limit = await emailLimiter(request);
    if (!limit.isAllowed && limit.isExceeded) {
      throw new RateLimitError('Muitos pedidos para este e-mail. Tente de novo mais tarde.');
    }
  }

  /** Abre uma sessão nova (descarta a que o navegador tinha) e grava o cookie. */
  async function startSession(
    request: FastifyRequest,
    reply: { setCookie: (name: string, value: string, options: object) => unknown },
    userId: string,
    activeCompanyId: string | null,
  ) {
    if (request.auth) await destroySession(request.auth.session.id);
    const { token, expiresAt } = await createSession({
      userId,
      ttlDays: env.SESSION_TTL_DAYS,
      activeCompanyId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    await systemDb.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(secureCookie, expiresAt));
    const auth = await loadSession(token);
    if (!auth) throw new AuthenticationError();
    return buildMe(auth);
  }

  app.post(
    '/login',
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const limit = await accountLimiter(request);
      if (!limit.isAllowed && limit.isExceeded) {
        request.log.warn(
          { security: 'login_account_limited' },
          'Login bloqueado por excesso de tentativas',
        );
        throw new RateLimitError('Muitas tentativas de login. Aguarde alguns minutos.');
      }
      const user = await authenticate(request.body.email, request.body.password);
      if (!user) {
        request.log.info({ security: 'login_failed' }, 'Falha de login');
        throw new AuthenticationError('E-mail ou senha inválidos.');
      }
      // Só chega aqui quem acertou a senha: dizer que falta confirmar o e-mail não expõe nada.
      if (!user.emailVerifiedAt) {
        throw new AuthorizationError(
          'Confirme seu e-mail para entrar. Enviamos o link no cadastro.',
          {
            details: { reason: 'EMAIL_NOT_VERIFIED' },
          },
        );
      }
      await auditPlatform(
        { type: 'USER', userId: user.id, label: user.name },
        { action: 'user.login', resourceType: 'User', resourceId: user.id, ip: request.ip },
      );

      // Fixação de sessão: a sessão que o navegador já tinha (outro usuário ou token plantado)
      // deixa de valer; o login sempre emite um token novo.
      if (request.auth) await destroySession(request.auth.session.id);
      const { token, expiresAt } = await createSession({
        userId: user.id,
        ttlDays: env.SESSION_TTL_DAYS,
        activeCompanyId: await defaultCompanyFor(user.id),
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      await systemDb.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(secureCookie, expiresAt));

      const auth = await loadSession(token);
      if (!auth) throw new AuthenticationError();
      return buildMe(auth);
    },
  );

  app.post('/logout', async (request, reply) => {
    if (request.auth) await destroySession(request.auth.session.id);
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(secureCookie));
    return { ok: true };
  });

  app.get('/me', { preValidation: authenticated }, async (request) =>
    buildMe(requireAuthContext(request)),
  );

  app.post(
    '/switch-company',
    { preValidation: authenticated, schema: { body: z.object({ companyId: z.uuid() }) } },
    async (request) => {
      const auth = requireAuthContext(request);
      const membership = await systemDb.companyMember.findUnique({
        where: { companyId_userId: { companyId: request.body.companyId, userId: auth.user.id } },
        include: { company: { select: { status: true } } },
      });
      if (!membership || !membership.isActive || membership.company.status === 'CANCELLED') {
        throw new AuthorizationError('Você não tem acesso a esta empresa.');
      }
      await systemDb.session.update({
        where: { id: auth.session.id },
        data: {
          activeCompanyId: request.body.companyId,
          supportCompanyId: null,
          supportExpiresAt: null,
        },
      });
      return buildMe({
        ...auth,
        session: {
          ...auth.session,
          activeCompanyId: request.body.companyId,
          supportCompanyId: null,
          supportExpiresAt: null,
        },
      });
    },
  );

  app.post(
    '/change-password',
    {
      preValidation: authenticated,
      schema: {
        body: z.object({
          currentPassword: z.string().min(1).max(200),
          newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
        }),
      },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const user = await systemDb.user.findUniqueOrThrow({ where: { id: auth.user.id } });
      if (!(await verifyPassword(user.passwordHash, request.body.currentPassword))) {
        throw new ValidationError('Senha atual incorreta.');
      }
      if (request.body.currentPassword === request.body.newPassword) {
        throw new ValidationError('A nova senha deve ser diferente da atual.');
      }
      await systemDb.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(request.body.newPassword),
          mustChangePassword: false,
        },
      });
      await destroyUserSessions(user.id, auth.session.id);
      await auditPlatform(
        { type: 'USER', userId: user.id, label: user.name },
        {
          action: 'user.password_changed',
          resourceType: 'User',
          resourceId: user.id,
          ip: request.ip,
        },
      );
      return { ok: true };
    },
  );

  // ── Cadastro, confirmação de e-mail e recuperação de senha ────────────────
  app.post(
    '/signup',
    { schema: { body: signupSchema }, config: emailRouteLimit },
    async (request, reply) => {
      if (!env.SIGNUP_ENABLED) throw new NotFoundError('Cadastro indisponível.');
      await assertEmailQuota(request);
      const { acceptTerms: _accepted, ...input } = request.body;
      await signup(container, { ...input, timezone: 'America/Sao_Paulo' }, { ip: request.ip });
      return reply.status(202).send({ ok: true });
    },
  );

  app.post(
    '/verify-email',
    {
      schema: { body: z.object({ token: tokenSchema }) },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { userId } = await verifyEmail(container, request.body.token);
      return startSession(request, reply, userId, await defaultCompanyFor(userId));
    },
  );

  app.post(
    '/resend-verification',
    { schema: { body: z.object({ email: emailSchema }) }, config: emailRouteLimit },
    async (request, reply) => {
      await assertEmailQuota(request);
      await resendVerification(container, request.body.email);
      return reply.status(202).send({ ok: true });
    },
  );

  app.post(
    '/forgot-password',
    { schema: { body: z.object({ email: emailSchema }) }, config: emailRouteLimit },
    async (request, reply) => {
      await assertEmailQuota(request);
      await forgotPassword(container, request.body.email);
      return reply.status(202).send({ ok: true });
    },
  );

  app.post(
    '/reset-password',
    {
      schema: { body: z.object({ token: tokenSchema, password: newPasswordSchema }) },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request) => {
      await resetPassword(container, request.body.token, request.body.password, { ip: request.ip });
      return { ok: true };
    },
  );

  // ── Convites para equipe ──────────────────────────────────────────────────
  app.post(
    '/invitations/preview',
    {
      schema: { body: z.object({ token: tokenSchema }) },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request) => previewInvitation(request.body.token),
  );

  app.post(
    '/invitations/accept',
    {
      schema: {
        body: z.object({
          token: tokenSchema,
          name: z.string().trim().min(2).max(120).optional(),
          password: newPasswordSchema.optional(),
        }),
      },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { userId, companyId } = await acceptInvitation(container, request.body.token, {
        auth: request.auth,
        name: request.body.name,
        password: request.body.password,
        ip: request.ip,
      });
      if (request.auth && request.auth.user.id === userId) {
        await systemDb.session.update({
          where: { id: request.auth.session.id },
          data: { activeCompanyId: companyId, supportCompanyId: null, supportExpiresAt: null },
        });
        const auth = await loadSession(request.cookies[SESSION_COOKIE] ?? '');
        if (!auth) throw new AuthenticationError();
        return buildMe(auth);
      }
      return startSession(request, reply, userId, companyId);
    },
  );

  // ── Sessões ativas do próprio usuário ─────────────────────────────────────
  app.get('/sessions', { preValidation: authenticated }, async (request) => {
    const auth = requireAuthContext(request);
    return listUserSessions(auth.user.id, auth.session.id);
  });

  app.delete(
    '/sessions/:id',
    { preValidation: authenticated, schema: { params: idParamSchema } },
    async (request) => {
      const auth = requireAuthContext(request);
      if (request.params.id === auth.session.id) {
        throw new ValidationError('Para encerrar esta sessão, use "Sair".');
      }
      // Só sessões do próprio usuário: o filtro por userId impede encerrar a de outra pessoa.
      const removed = await systemDb.session.deleteMany({
        where: { id: request.params.id, userId: auth.user.id },
      });
      if (removed.count === 0) throw new NotFoundError('Sessão não encontrada.');
      return { ok: true };
    },
  );

  app.post('/sessions/revoke-others', { preValidation: authenticated }, async (request) => {
    const auth = requireAuthContext(request);
    await destroyUserSessions(auth.user.id, auth.session.id);
    await auditPlatform(
      { type: 'USER', userId: auth.user.id, label: auth.user.name },
      {
        action: 'user.sessions_revoked',
        resourceType: 'User',
        resourceId: auth.user.id,
        ip: request.ip,
      },
    );
    return { ok: true };
  });
};
