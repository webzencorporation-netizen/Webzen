import { isModelCompatible, type AIProviderName, type Env } from '@botsaas/config';
import { systemDb } from '@botsaas/database';

/** Modelos disponíveis para escolha no painel: tabela de preços ativa, só do provedor ativo. */
export async function listAvailableModels(provider: AIProviderName) {
  const rows = await systemDb.modelPricing.findMany({
    where: { isActive: true },
    orderBy: { model: 'asc' },
    select: { model: true, displayName: true },
  });
  return rows
    .filter((row) => isModelCompatible(provider, row.model))
    .map((row) => ({ id: row.model, name: row.displayName ?? row.model }));
}

/**
 * Modelo que a empresa realmente usa: o escolhido por ela quando serve ao provedor ativo;
 * senão o padrão da plataforma (ex.: `claude-*` salvo e a plataforma migrou para a Meta).
 */
export function effectiveModel(
  configured: string | null | undefined,
  env: Pick<Env, 'AI_PROVIDER' | 'AI_DEFAULT_MODEL'>,
): string {
  return configured && isModelCompatible(env.AI_PROVIDER, configured)
    ? configured
    : env.AI_DEFAULT_MODEL;
}
