import { API_SCOPES, WEBHOOK_EVENTS } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, paginationQuerySchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as apiKeys from '../../developer/api-keys';
import * as webhooks from '../../developer/webhooks';
import { feature } from '../../features/service';

const keyBody = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

const endpointBody = z.object({
  url: z.string().trim().min(8).max(500),
  description: z.string().trim().max(200).nullish(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

/** API e webhooks da empresa (recursos do plano). Só quem administra a empresa. */
export const developerRoutes: FastifyPluginAsyncZod = async (app) => {
  const keys = [company('developer:manage'), feature('API_ACCESS')];
  const hooks = [company('developer:manage'), feature('WEBHOOKS')];
  const sensitive = { rateLimit: { max: 30, timeWindow: '1 hour' } };

  app.get('/api-keys', { preValidation: keys }, async (request) =>
    apiKeys.listApiKeys(scopeFromRequest(request)),
  );
  app.post(
    '/api-keys',
    { preValidation: keys, schema: { body: keyBody }, config: sensitive },
    async (request, reply) =>
      reply.status(201).send(await apiKeys.createApiKey(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/api-keys/:id',
    { preValidation: keys, schema: { params: idParamSchema, body: keyBody.partial() } },
    async (request) =>
      apiKeys.updateApiKey(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/api-keys/:id',
    { preValidation: keys, schema: { params: idParamSchema } },
    async (request) => {
      await apiKeys.revokeApiKey(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get('/webhooks', { preValidation: hooks }, async (request) =>
    webhooks.listEndpoints(scopeFromRequest(request)),
  );
  app.post(
    '/webhooks',
    { preValidation: hooks, schema: { body: endpointBody }, config: sensitive },
    async (request, reply) =>
      reply
        .status(201)
        .send(await webhooks.createEndpoint(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/webhooks/:id',
    {
      preValidation: hooks,
      schema: {
        params: idParamSchema,
        body: endpointBody.partial().extend({ isActive: z.boolean().optional() }),
      },
    },
    async (request) =>
      webhooks.updateEndpoint(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/webhooks/:id',
    { preValidation: hooks, schema: { params: idParamSchema } },
    async (request) => {
      await webhooks.deleteEndpoint(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
  app.post(
    '/webhooks/:id/rotate-secret',
    { preValidation: hooks, schema: { params: idParamSchema }, config: sensitive },
    async (request) => webhooks.rotateEndpointSecret(scopeFromRequest(request), request.params.id),
  );
  app.post(
    '/webhooks/:id/test',
    {
      preValidation: hooks,
      schema: { params: idParamSchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => webhooks.sendTestEvent(scopeFromRequest(request), request.params.id),
  );
  app.get(
    '/webhooks/:id/deliveries',
    { preValidation: hooks, schema: { params: idParamSchema, querystring: paginationQuerySchema } },
    async (request) =>
      webhooks.listDeliveries(scopeFromRequest(request), request.params.id, request.query),
  );
  app.post(
    '/webhook-deliveries/:id/redeliver',
    { preValidation: hooks, schema: { params: idParamSchema } },
    async (request) => {
      await webhooks.redeliver(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
};
