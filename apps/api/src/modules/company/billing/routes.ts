import { BILLING_INTERVALS } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as billing from '../../billing/service';

/** Plano e período escolhidos; o preço é sempre o oficial do plano no servidor/gateway. */
const planChoice = z.object({
  planKey: z.string().regex(/^[A-Z0-9_]{2,30}$/),
  interval: z.enum(BILLING_INTERVALS),
});

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = company('billing:read');
  const manage = company('billing:manage');
  const gatewayLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/', { preValidation: read }, async (request) =>
    billing.getBillingOverview(scopeFromRequest(request)),
  );

  app.get(
    '/invoices',
    { preValidation: read, schema: { querystring: paginationQuerySchema } },
    async (request) => billing.listInvoices(scopeFromRequest(request), request.query),
  );

  app.post(
    '/checkout',
    { preValidation: manage, schema: { body: planChoice }, config: gatewayLimit },
    async (request) => billing.startCheckout(scopeFromRequest(request), request.body),
  );

  app.post('/portal', { preValidation: manage, config: gatewayLimit }, async (request) =>
    billing.openBillingPortal(scopeFromRequest(request)),
  );

  app.post(
    '/change-plan',
    { preValidation: manage, schema: { body: planChoice }, config: gatewayLimit },
    async (request) => {
      await billing.changePlan(scopeFromRequest(request), request.body);
      return billing.getBillingOverview(scopeFromRequest(request));
    },
  );

  app.post('/cancel', { preValidation: manage, config: gatewayLimit }, async (request) => {
    await billing.setCancellation(scopeFromRequest(request), true);
    return billing.getBillingOverview(scopeFromRequest(request));
  });

  app.post('/reactivate', { preValidation: manage, config: gatewayLimit }, async (request) => {
    await billing.setCancellation(scopeFromRequest(request), false);
    return billing.getBillingOverview(scopeFromRequest(request));
  });
};
