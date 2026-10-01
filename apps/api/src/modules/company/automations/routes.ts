import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, patchSchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as automations from '../../automations/service';
import { automationInputSchema } from '../../automations/types';
import { feature } from '../../features/service';

export const automationRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = [company('automations:read'), feature('AUTOMATIONS')];
  const write = [company('automations:write'), feature('AUTOMATIONS')];

  app.get('/', { preValidation: read }, async (request) =>
    automations.listAutomations(scopeFromRequest(request)),
  );
  app.post(
    '/',
    { preValidation: write, schema: { body: automationInputSchema } },
    async (request, reply) =>
      reply
        .status(201)
        .send(await automations.createAutomation(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/:id',
    {
      preValidation: write,
      schema: { params: idParamSchema, body: patchSchema(automationInputSchema) },
    },
    async (request) =>
      automations.updateAutomation(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/:id',
    { preValidation: write, schema: { params: idParamSchema } },
    async (request) => {
      await automations.deleteAutomation(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
  app.get(
    '/runs',
    {
      preValidation: read,
      schema: { querystring: z.object({ automationId: z.uuid().optional() }) },
    },
    async (request) =>
      automations.listAutomationRuns(scopeFromRequest(request), request.query.automationId),
  );
};
