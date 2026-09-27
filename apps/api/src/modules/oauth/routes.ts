import { systemDb } from '@botsaas/database';
import { roleHasPermission } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { systemScope } from '../../lib/scope';
import { completeGoogleConnect, verifyState } from '../company/integrations/service';

/** Retorno do OAuth do Google (navegação de topo; o state assinado vincula empresa e usuário). */
export const oauthRoutes: FastifyPluginAsyncZod = async (app) => {
  const { env } = app.container;
  const redirect = (status: string) => `${env.APP_URL}/app/integrations?google=${status}`;

  app.get(
    '/google/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string().max(2000).optional(),
          state: z.string().max(500).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error || !code || !state || !env.ENCRYPTION_KEY) return reply.redirect(redirect('error'));
      const parsed = verifyState(env.ENCRYPTION_KEY, state);
      if (!parsed || request.auth?.user.id !== parsed.userId)
        return reply.redirect(redirect('error'));
      const membership = await systemDb.companyMember.findUnique({
        where: { companyId_userId: { companyId: parsed.companyId, userId: parsed.userId } },
      });
      if (!membership?.isActive || !roleHasPermission(membership.role, 'integrations:manage'))
        return reply.redirect(redirect('forbidden'));
      try {
        await completeGoogleConnect(
          systemScope(app.container, parsed.companyId, {
            type: 'USER',
            userId: parsed.userId,
            label: request.auth.user.name,
          }),
          code,
        );
        return reply.redirect(redirect('connected'));
      } catch (connectError) {
        request.log.warn({ err: connectError }, 'Falha ao conectar Google Calendar');
        return reply.redirect(redirect('error'));
      }
    },
  );
};
