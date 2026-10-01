import { systemDb } from '@botsaas/database';
import { FEATURE_LABELS, yearlySavings, type FeatureFlagKey } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** Planos à venda, no formato da página de preços. Sem IDs da Stripe nem dados internos. */
export async function listPublicPlans() {
  const plans = await systemDb.plan.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
    select: {
      key: true,
      name: true,
      tagline: true,
      description: true,
      priceMonthlyCents: true,
      priceYearlyCents: true,
      currency: true,
      highlight: true,
      limits: true,
      features: true,
    },
  });
  return plans.map((plan) => ({
    ...plan,
    features: plan.features.map((flag: FeatureFlagKey) => ({
      flag,
      label: FEATURE_LABELS[flag],
    })),
    yearlySavings: yearlySavings(plan.priceMonthlyCents, plan.priceYearlyCents),
  }));
}

/**
 * Rotas públicas (site institucional). Somente leitura de dados não sensíveis; o rate
 * limit global continua valendo.
 */
export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/plans', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { plans: await listPublicPlans() };
  });
};
