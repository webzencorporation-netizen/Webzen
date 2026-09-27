import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, optionalText } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as integrations from './service';

export const integrationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { preValidation: company('integrations:read') }, async (request) =>
    integrations.getIntegrations(scopeFromRequest(request)),
  );

  app.post(
    '/whatsapp/accounts',
    {
      preValidation: company('integrations:manage'),
      schema: {
        body: z.object({
          phoneNumberId: z
            .string()
            .regex(/^[0-9]{5,30}$/, 'ID numérico do número (Phone number ID)'),
          wabaId: z
            .string()
            .regex(/^[0-9]{5,30}$/)
            .nullish(),
          accessToken: z.string().min(20).max(1000).nullish(),
          displayPhoneNumber: optionalText(30),
        }),
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await integrations.addWhatsAppAccount(scopeFromRequest(request), request.body)),
  );

  app.patch(
    '/whatsapp/accounts/:id',
    {
      preValidation: company('integrations:manage'),
      schema: {
        params: idParamSchema,
        body: z.object({
          accessToken: z.string().min(20).max(1000).optional(),
          isDefault: z.boolean().optional(),
          wabaId: z
            .string()
            .regex(/^[0-9]{5,30}$/)
            .nullish(),
        }),
      },
    },
    async (request) =>
      integrations.updateWhatsAppAccount(
        scopeFromRequest(request),
        request.params.id,
        request.body,
      ),
  );

  app.post(
    '/whatsapp/accounts/:id/verify',
    { preValidation: company('integrations:manage'), schema: { params: idParamSchema } },
    async (request) =>
      integrations.verifyWhatsAppAccount(scopeFromRequest(request), request.params.id),
  );

  app.delete(
    '/whatsapp/accounts/:id',
    { preValidation: company('integrations:manage'), schema: { params: idParamSchema } },
    async (request) => {
      await integrations.removeWhatsAppAccount(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/whatsapp/accounts/:id/templates/sync',
    { preValidation: company('integrations:manage'), schema: { params: idParamSchema } },
    async (request) => integrations.syncTemplates(scopeFromRequest(request), request.params.id),
  );

  app.get(
    '/whatsapp/templates',
    { preValidation: company('conversations:read') },
    async (request) => integrations.listTemplates(scopeFromRequest(request)),
  );

  app.post(
    '/whatsapp/simulate',
    {
      preValidation: company('integrations:manage'),
      schema: {
        body: z.object({
          from: z.string().min(8).max(20),
          name: optionalText(80),
          text: z.string().trim().min(1).max(2000),
        }),
      },
    },
    async (request) => integrations.simulateInboundMessage(scopeFromRequest(request), request.body),
  );

  app.post('/google/connect', { preValidation: company('integrations:manage') }, async (request) =>
    integrations.startGoogleConnect(scopeFromRequest(request)),
  );

  app.delete('/google', { preValidation: company('integrations:manage') }, async (request) => {
    await integrations.disconnectGoogle(scopeFromRequest(request));
    return { ok: true };
  });
};
