import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema } from '../../../lib/http';
import { company, requireAuthContext, requireTenant } from '../../../plugins/guards';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../notifications/service';

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preValidation: company(),
      schema: {
        querystring: z.object({
          unreadOnly: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
    },
    async (request) =>
      listNotifications(
        requireTenant(request).companyId,
        requireAuthContext(request).user.id,
        request.query,
      ),
  );
  app.post(
    '/:id/read',
    { preValidation: company(), schema: { params: idParamSchema } },
    async (request) => {
      await markNotificationRead(
        requireTenant(request).companyId,
        requireAuthContext(request).user.id,
        request.params.id,
      );
      return { ok: true };
    },
  );
  app.post('/read-all', { preValidation: company() }, async (request) => {
    await markAllNotificationsRead(
      requireTenant(request).companyId,
      requireAuthContext(request).user.id,
    );
    return { ok: true };
  });
};
