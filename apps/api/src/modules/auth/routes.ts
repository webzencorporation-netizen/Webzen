import { hashPassword, PASSWORD_MIN_LENGTH, systemDb, verifyPassword } from '@botsaas/database';
import { AuthenticationError, AuthorizationError, ValidationError } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticated, requireAuthContext } from '../../plugins/guards';
import { sessionCookieOptions } from '../../plugins/auth';
import { auditPlatform } from '../../lib/audit';
import { authenticate, buildMe, defaultCompanyFor } from './service';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  loadSession,
  SESSION_COOKIE,
} from './sessions';

const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { env } = app.container;
  const secureCookie = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';

  app.post(
    '/login',
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: env.LOGIN_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = await authenticate(request.body.email, request.body.password);
      if (!user) throw new AuthenticationError('E-mail ou senha inválidos.');

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
};
