import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AppContainer } from './container';
import { registerAuth } from './plugins/auth';
import { registerCsrf } from './plugins/csrf';
import { registerErrorHandling } from './plugins/errors';
import { registerRouteInventory } from './plugins/route-inventory';
import { authRoutes } from './modules/auth/routes';
import { companyRoutes } from './modules/company/routes';
import { platformRoutes } from './modules/platform/routes';
import { publicRoutes } from './modules/public/routes';
import { oauthRoutes } from './modules/oauth/routes';
import { webhookRoutes } from './modules/webhooks/routes';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

export async function buildApp(container: AppContainer): Promise<FastifyInstance> {
  const { env } = container;
  // Nunca `true`: o IP de `X-Forwarded-For` só vale vindo de proxy configurado (TRUST_PROXY).
  // Número = saltos confiáveis a partir do servidor (mesma regra do Fastify para inteiros).
  const trustProxy =
    typeof env.TRUST_PROXY === 'number'
      ? (
          (hops: number) => (_address: string, hop: number) =>
            hop < hops
        )(env.TRUST_PROXY)
      : env.TRUST_PROXY;
  const app = Fastify({
    loggerInstance: container.logger as FastifyBaseLogger,
    trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
    disableRequestLogging: env.NODE_ENV === 'test',
  });

  app.decorate('container', container);
  registerRouteInventory(app);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Guarda o corpo bruto: a assinatura dos webhooks é calculada sobre os bytes recebidos.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      const error = new Error('JSON inválido') as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    ...(container.redis ? { redis: container.redis, nameSpace: 'botsaas-rl-' } : {}),
    allowList: (request) => request.url.startsWith('/health'),
  });
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  });

  registerErrorHandling(app);
  registerAuth(app);
  registerCsrf(app, [env.APP_URL, env.API_PUBLIC_URL]);

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      const { systemDb } = await import('@botsaas/database');
      await systemDb.$queryRaw`SELECT 1`;
      if (container.redis) await container.redis.ping();
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(platformRoutes, { prefix: '/api/platform' });
  await app.register(companyRoutes, { prefix: '/api/app' });
  await app.register(oauthRoutes, { prefix: '/api/integrations' });
  await app.register(webhookRoutes, { prefix: '/webhooks' });

  return app;
}
