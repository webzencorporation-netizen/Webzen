import type { FastifyInstance } from 'fastify';
import { loadSession, SESSION_COOKIE } from '../modules/auth/sessions';

/** Carrega a sessão (se houver) em `request.auth` para todas as rotas. */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await loadSession(token) : null;
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
