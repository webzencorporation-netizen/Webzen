import { FEEDBACK_CATEGORIES, TICKET_CATEGORIES, TICKET_STATUSES } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, paginationQuerySchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as support from './service';

const body = z.string().trim().min(2).max(5000);

export const supportRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = company('support:read');
  const write = company('support:write');
  const writeLimit = { rateLimit: { max: 30, timeWindow: '1 hour' } };

  app.get(
    '/tickets',
    {
      preValidation: read,
      schema: {
        querystring: paginationQuerySchema.extend({ status: z.enum(TICKET_STATUSES).optional() }),
      },
    },
    async (request) => support.listTickets(scopeFromRequest(request), request.query),
  );
  app.get(
    '/tickets/:id',
    { preValidation: read, schema: { params: idParamSchema } },
    async (request) => support.getTicket(scopeFromRequest(request), request.params.id),
  );
  app.post(
    '/tickets',
    {
      preValidation: write,
      schema: {
        body: z.object({
          subject: z.string().trim().min(4).max(160),
          category: z.enum(TICKET_CATEGORIES),
          body,
        }),
      },
      config: writeLimit,
    },
    async (request, reply) =>
      reply.status(201).send(await support.createTicket(scopeFromRequest(request), request.body)),
  );
  app.post(
    '/tickets/:id/messages',
    {
      preValidation: write,
      schema: { params: idParamSchema, body: z.object({ body }) },
      config: writeLimit,
    },
    async (request) =>
      support.replyTicket(scopeFromRequest(request), request.params.id, request.body.body),
  );
  app.post(
    '/tickets/:id/close',
    { preValidation: write, schema: { params: idParamSchema } },
    async (request) => support.closeTicket(scopeFromRequest(request), request.params.id),
  );
  app.post(
    '/tickets/:id/reopen',
    { preValidation: write, schema: { params: idParamSchema } },
    async (request) => support.reopenTicket(scopeFromRequest(request), request.params.id),
  );

  // Feedback: qualquer pessoa da equipe pode enviar (só escreve na própria empresa).
  app.post(
    '/feedback',
    {
      preValidation: company('company:read'),
      schema: {
        body: z.object({
          category: z.enum(FEEDBACK_CATEGORIES),
          message: z.string().trim().min(3).max(3000),
          page: z.string().max(300).nullish(),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      await support.sendFeedback(scopeFromRequest(request), request.body);
      return reply.status(201).send({ ok: true });
    },
  );
};
