import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { paginationQuerySchema, toSkipTake } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preValidation: company('audit:read'),
      schema: {
        querystring: paginationQuerySchema.extend({ action: z.string().max(80).optional() }),
      },
    },
    async (request) => {
      const scope = scopeFromRequest(request);
      const where = request.query.action ? { action: { startsWith: request.query.action } } : {};
      const [total, items] = await Promise.all([
        scope.db.auditLog.count({ where }),
        scope.db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...toSkipTake(request.query),
        }),
      ]);
      return { items, total, page: request.query.page, pageSize: request.query.pageSize };
    },
  );
};
