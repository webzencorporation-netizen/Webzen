import { systemDb } from '@botsaas/database';
import { FEATURE_LABELS, yearlySavings, type FeatureFlagKey } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContainer } from '../../container';
import { getPlatformHealth } from '../platform/health.service';

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

export type PublicComponentState =
  'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'not_monitored';

const STATE_RANK: Record<PublicComponentState, number> = {
  not_monitored: 0,
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

const fromInternal = (status: string): PublicComponentState =>
  status === 'ok'
    ? 'operational'
    : status === 'degraded'
      ? 'degraded'
      : status === 'down'
        ? 'major_outage'
        : 'not_monitored';

let cachedStatus: { at: number; value: Awaited<ReturnType<typeof computePublicStatus>> } | null =
  null;
const STATUS_CACHE_MS = 60_000;

/**
 * Status público: só o estado de cada componente, sem latências, contagens ou mensagens de
 * erro (que poderiam expor a infraestrutura). Cache de 1 minuto: a página pública não pode
 * virar um jeito de martelar banco, Redis e storage.
 */
async function computePublicStatus(container: AppContainer) {
  const health = await getPlatformHealth(container);
  const state = (key: string) => fromInternal(health.components[key]?.status ?? 'not_configured');
  const database = state('database');
  const components = [
    { key: 'website', name: 'Site e painel', state: 'operational' as PublicComponentState },
    {
      key: 'api',
      name: 'API',
      state: (database === 'major_outage'
        ? 'partial_outage'
        : 'operational') as PublicComponentState,
    },
    { key: 'database', name: 'Banco de dados', state: database },
    { key: 'bots', name: 'Atendimento automático', state: state('workers') },
    { key: 'whatsapp', name: 'WhatsApp', state: state('whatsapp') },
    { key: 'ai', name: 'Provedores de IA', state: state('anthropic') },
  ];
  const worst = components.reduce<PublicComponentState>(
    (current, component) =>
      STATE_RANK[component.state] > STATE_RANK[current] ? component.state : current,
    'operational',
  );
  return { overall: worst, components, checkedAt: health.checkedAt };
}

export async function getPublicStatus(container: AppContainer, now = Date.now()) {
  if (cachedStatus && now - cachedStatus.at < STATUS_CACHE_MS) return cachedStatus.value;
  const value = await computePublicStatus(container);
  cachedStatus = { at: now, value };
  return value;
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

  app.get('/status', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return getPublicStatus(app.container);
  });
};
