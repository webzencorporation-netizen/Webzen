import { DEFAULT_MODEL_PRICING } from '@botsaas/ai';
import { systemDb, type Prisma } from '@botsaas/database';
import { BILLING_INTERVALS, DEFAULT_PLANS, type PlanDefinition } from '@botsaas/shared';

const STRIPE_PRICE_PATTERN = /^price_[A-Za-z0-9]+$/;

/**
 * IDs de preço da Stripe por ambiente: `STRIPE_PRICE_<PLANO>_<MONTHLY|YEARLY>`
 * (ex.: `STRIPE_PRICE_PRO_YEARLY=price_...`). Ausente = mantém o que está no banco.
 */
export function stripePriceIdsFromEnv(
  key: string,
  source: NodeJS.ProcessEnv = process.env,
): { stripePriceMonthlyId?: string; stripePriceYearlyId?: string } {
  const result: { stripePriceMonthlyId?: string; stripePriceYearlyId?: string } = {};
  for (const interval of BILLING_INTERVALS) {
    const name = `STRIPE_PRICE_${key}_${interval}`;
    const value = source[name]?.trim();
    if (!value) continue;
    if (!STRIPE_PRICE_PATTERN.test(value)) {
      throw new Error(`${name} inválido: esperado um ID de preço da Stripe (price_...).`);
    }
    if (interval === 'MONTHLY') result.stripePriceMonthlyId = value;
    else result.stripePriceYearlyId = value;
  }
  return result;
}

function catalogFields(plan: PlanDefinition) {
  return {
    name: plan.name,
    tagline: plan.tagline,
    description: plan.description,
    priceMonthlyCents: plan.priceMonthlyCents,
    priceYearlyCents: plan.priceYearlyCents,
    limits: plan.limits as Prisma.InputJsonValue,
    features: plan.features,
    highlight: plan.highlight,
    sortOrder: plan.sortOrder,
  };
}

export interface ReferenceSeedOptions {
  /**
   * Sobrescreve preços, limites e recursos dos planos existentes com o catálogo do código
   * (`DEFAULT_PLANS`). Sem a opção, planos existentes não mudam — preserva ajustes feitos
   * pelo administrador no painel.
   */
  syncPlans?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Dados de referência idempotentes (planos e preços de modelos). Seguro em qualquer ambiente. */
export async function seedReferenceData(options: ReferenceSeedOptions = {}): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    const priceIds = stripePriceIdsFromEnv(plan.key, options.env);
    await systemDb.plan.upsert({
      where: { key: plan.key },
      create: { key: plan.key, ...catalogFields(plan), ...priceIds },
      update: { ...(options.syncPlans ? catalogFields(plan) : {}), ...priceIds },
    });
  }
  for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICING)) {
    await systemDb.modelPricing.upsert({
      where: { model },
      create: { model, ...price },
      update: {},
    });
  }
}
