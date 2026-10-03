import type { PublicPlan } from '@/features/billing/plans';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * Planos para páginas públicas renderizadas no servidor. Revalida a cada 5 min; se a API
 * estiver indisponível (inclusive no build), devolve null e a página mostra um aviso.
 */
export async function fetchPublicPlans(): Promise<PublicPlan[] | null> {
  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/public/plans`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { plans: PublicPlan[] }).plans;
  } catch {
    return null;
  }
}
