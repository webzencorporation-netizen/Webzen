import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getOwnCompany } from '../../../lib/company-record';
import { scopeFromRequest } from '../../../lib/scope';
import { periodStart } from '../../../lib/time';
import { company } from '../../../plugins/guards';
import { getDailySeries, getOverviewMetrics } from '../../metrics/service';
import { getUsageStatus } from '../../usage/limits';
import { costByConversation, summarizeAiUsageByPeriod } from '../../usage/report';

const periodSchema = z.enum(['today', '7d', '30d', 'month']);

export const metricsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/overview',
    {
      preValidation: company('reports:read'),
      schema: { querystring: z.object({ period: periodSchema.default('30d') }) },
    },
    async (request) => getOverviewMetrics(scopeFromRequest(request), request.query.period),
  );

  app.get(
    '/series',
    {
      preValidation: company('reports:read'),
      schema: {
        querystring: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }),
      },
    },
    async (request) => getDailySeries(scopeFromRequest(request), request.query.days),
  );

  /** Consumo da IA (seção avançada: tokens, cache, custo estimado). */
  app.get(
    '/usage',
    {
      preValidation: company('usage:read'),
      schema: { querystring: z.object({ period: periodSchema.default('30d') }) },
    },
    async (request) => {
      const scope = scopeFromRequest(request);
      const own = await getOwnCompany(scope);
      const [periods, topConversations, limits] = await Promise.all([
        summarizeAiUsageByPeriod({
          companyId: scope.companyId,
          timezone: own.timezone,
          includeTests: true,
        }),
        costByConversation(scope.companyId, periodStart(request.query.period, own.timezone)),
        getUsageStatus(scope),
      ]);
      return { periods, topConversations, limits };
    },
  );
};
