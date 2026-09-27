import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, paginationQuerySchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as inbox from './service';

export const conversationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preValidation: company('conversations:read'),
      schema: {
        querystring: paginationQuerySchema.extend({
          filter: z.enum(inbox.INBOX_FILTERS).default('all'),
          search: z.string().max(100).optional(),
          tagId: z.uuid().optional(),
        }),
      },
    },
    async (request) => inbox.listConversations(scopeFromRequest(request), request.query),
  );

  app.get('/counters', { preValidation: company('conversations:read') }, async (request) =>
    inbox.conversationCounters(scopeFromRequest(request)),
  );

  app.get(
    '/:id',
    { preValidation: company('conversations:read'), schema: { params: idParamSchema } },
    async (request) => inbox.getConversation(scopeFromRequest(request), request.params.id),
  );

  app.get(
    '/:id/messages',
    {
      preValidation: company('conversations:read'),
      schema: {
        params: idParamSchema,
        querystring: z.object({
          before: z.coerce.date().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) =>
      inbox.listMessages(scopeFromRequest(request), request.params.id, request.query),
  );

  app.post(
    '/:id/read',
    { preValidation: company('conversations:read'), schema: { params: idParamSchema } },
    async (request) => {
      await inbox.markConversationRead(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/:id/messages',
    {
      preValidation: company('conversations:reply'),
      schema: {
        params: idParamSchema,
        body: z.object({ text: z.string().trim().min(1).max(4096) }),
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await inbox.replyAsAgent(scopeFromRequest(request), request.params.id, request.body.text),
        ),
  );

  app.post(
    '/:id/template',
    {
      preValidation: company('conversations:reply'),
      schema: {
        params: idParamSchema,
        body: z.object({
          templateName: z.string().min(1).max(100),
          languageCode: z.string().min(2).max(10),
          bodyParameters: z.array(z.string().max(500)).max(10).default([]),
        }),
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await inbox.sendTemplate(scopeFromRequest(request), request.params.id, request.body)),
  );

  app.post(
    '/:id/mode',
    {
      preValidation: company('conversations:mode'),
      schema: {
        params: idParamSchema,
        body: z.object({
          action: z.enum(['take_over', 'return_to_ai', 'pause', 'resume', 'request_human']),
        }),
      },
    },
    async (request) => {
      const scope = scopeFromRequest(request);
      await inbox.changeMode(scope, request.params.id, request.body.action);
      return inbox.getConversation(scope, request.params.id);
    },
  );

  app.post(
    '/:id/assign',
    {
      preValidation: company('conversations:assign'),
      schema: { params: idParamSchema, body: z.object({ userId: z.uuid().nullable() }) },
    },
    async (request) => {
      const scope = scopeFromRequest(request);
      await inbox.assignConversation(scope, request.params.id, request.body.userId);
      return inbox.getConversation(scope, request.params.id);
    },
  );

  app.post(
    '/:id/status',
    {
      preValidation: company('conversations:reply'),
      schema: { params: idParamSchema, body: z.object({ status: z.enum(['OPEN', 'CLOSED']) }) },
    },
    async (request) => {
      const scope = scopeFromRequest(request);
      await inbox.setConversationStatus(scope, request.params.id, request.body.status);
      return inbox.getConversation(scope, request.params.id);
    },
  );

  app.delete(
    '/:id',
    { preValidation: company('conversations:delete'), schema: { params: idParamSchema } },
    async (request) => {
      await inbox.deleteConversation(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get(
    '/media/:id',
    { preValidation: company('conversations:read'), schema: { params: idParamSchema } },
    async (request, reply) => {
      const media = await inbox.getMediaForDownload(scopeFromRequest(request), request.params.id);
      return reply
        .header('Content-Type', media.mimeType)
        .header('Content-Disposition', `inline; filename="${encodeURIComponent(media.fileName)}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, max-age=300')
        .send(media.data);
    },
  );
};
