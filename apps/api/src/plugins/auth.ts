import type { FastifyInstance } from 'fastify';
import { AuthorizationError } from '@botsaas/shared';
import { loadSession, SESSION_COOKIE } from '../modules/auth/sessions';

const PASSWORD_CHANGE_ALLOWED_ROUTES = new Set([
  'POST /api/auth/login',
  'GET /api/auth/me',
  'HEAD /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout',
]);

/** Carrega a sessão (se houver) em `request.auth` para todas as rotas. */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await loadSession(token) : null;
    // A rota registrada (sem query/entrada crua) define as únicas exceções para
    // sessões provisórias. O hook cobre também callbacks que não usam company/platform.
    const route = request.routeOptions.url;
    if (
      request.auth?.user.mustChangePassword &&
      route?.startsWith('/api/') &&
      !PASSWORD_CHANGE_ALLOWED_ROUTES.has(`${request.method} ${route}`)
    ) {
      throw new AuthorizationError('Troque sua senha temporária antes de continuar.', {
        details: { reason: 'PASSWORD_CHANGE_REQUIRED' },
      });
    }
  });
}

export function sessionCookieOptions(secure: boolean, expiresAt?: Date) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}
