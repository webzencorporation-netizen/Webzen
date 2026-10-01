import { PASSWORD_MIN_LENGTH } from '@botsaas/database';
import { COMPANY_ROLES } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as invitations from './invitations';
import * as team from './service';

export const teamRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { preValidation: company('team:read') }, async (request) =>
    team.listMembers(scopeFromRequest(request)),
  );

  app.post(
    '/',
    {
      preValidation: company('team:manage'),
      schema: {
        body: z.object({
          email: z.email().max(200),
          name: z.string().min(2).max(120),
          role: z.enum(COMPANY_ROLES),
          password: z.string().min(PASSWORD_MIN_LENGTH).max(200).nullish(),
        }),
      },
    },
    async (request, reply) =>
      reply.status(201).send(await team.addMember(scopeFromRequest(request), request.body)),
  );

  app.patch(
    '/:id',
    {
      preValidation: company('team:manage'),
      schema: {
        params: idParamSchema,
        body: z.object({
          role: z.enum(COMPANY_ROLES).optional(),
          isActive: z.boolean().optional(),
        }),
      },
    },
    async (request) =>
      team.updateMember(scopeFromRequest(request), request.params.id, request.body),
  );

  app.delete(
    '/:id',
    { preValidation: company('team:manage'), schema: { params: idParamSchema } },
    async (request) => {
      await team.removeMember(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  // ── Convites por e-mail ───────────────────────────────────────────────────
  app.get('/invitations', { preValidation: company('team:read') }, async (request) =>
    invitations.listInvitations(scopeFromRequest(request)),
  );

  app.post(
    '/invitations',
    {
      preValidation: company('team:manage'),
      schema: {
        body: z.object({
          email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
          role: z.enum(COMPANY_ROLES),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await invitations.createInvitation(scopeFromRequest(request), request.body)),
  );

  app.post(
    '/invitations/:id/resend',
    { preValidation: company('team:manage'), schema: { params: idParamSchema } },
    async (request) => {
      await invitations.resendInvitation(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.delete(
    '/invitations/:id',
    { preValidation: company('team:manage'), schema: { params: idParamSchema } },
    async (request) => {
      await invitations.revokeInvitation(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
};
