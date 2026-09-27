import { AuthorizationError } from '@botsaas/shared';
import type { FastifyInstance } from 'fastify';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Proteção CSRF para a API do painel (cookie SameSite=Lax + header customizado + Origin).
 * Navegadores não enviam headers customizados em requisições cross-site sem preflight CORS,
 * e a API não habilita CORS — então só o próprio painel consegue mutar.
 */
export function registerCsrf(app: FastifyInstance, allowedOrigins: string[]): void {
  const origins = new Set(allowedOrigins.map((url) => new URL(url).origin));
  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method) || !request.url.startsWith('/api/')) return;
    if (!request.headers['x-requested-with']) {
      throw new AuthorizationError('Requisição bloqueada (CSRF).');
    }
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) {
      throw new AuthorizationError('Origem não permitida.');
    }
  });
}
