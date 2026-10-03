import type { BillingInterval, FeatureFlagKey, UsageMetric } from '@botsaas/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Plano como a API pública devolve (sem IDs de pagamento). */
export interface PublicPlan {
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  currency: string;
  highlight: boolean;
  limits: Partial<Record<UsageMetric, number | null>>;
  features: { flag: FeatureFlagKey; label: string }[];
  yearlySavings: { cents: number; percent: number } | null;
}

export function usePublicPlans() {
  return useQuery({
    queryKey: ['public-plans'],
    queryFn: async () => (await api.get<{ plans: PublicPlan[] }>('/public/plans')).plans,
    staleTime: 5 * 60_000,
  });
}

export function priceFor(plan: PublicPlan, interval: BillingInterval): number | null {
  return interval === 'MONTHLY' ? plan.priceMonthlyCents : plan.priceYearlyCents;
}

/** Período na URL (`?periodo=anual`) ↔ enum da API. */
export const intervalFromParam = (value: string | null): BillingInterval => (value === 'anual' ? 'YEARLY' : 'MONTHLY');
export const intervalToParam = (interval: BillingInterval) => (interval === 'YEARLY' ? 'anual' : 'mensal');
