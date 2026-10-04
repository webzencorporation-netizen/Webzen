import { isModelCompatible, type AIProviderName, type Env } from '@botsaas/config';
import { systemDb } from '@botsaas/database';

/**
 * Modelos disponíveis para escolha no painel: tabela de preços ativa, só do provedor ativo,
 * mais o modelo padrão da plataforma — que pode não ter preço cadastrado (ex.: Gemini no
 * plano gratuito). Sem ele, salvar as configurações da IA falhava com "Modelo não disponível".
 */
export async function listAvailableModels(provider: AIProviderName, defaultModel?: string) {
  const rows = await systemDb.modelPricing.findMany({
    where: { isActive: true },
    orderBy: { model: 'asc' },
    select: { model: true, displayName: true },
  });
  const models = rows
    .filter((row) => isModelCompatible(provider, row.model))
    .map((row) => ({ id: row.model, name: row.displayName ?? row.model }));
  if (
    defaultModel &&
    isModelCompatible(provider, defaultModel) &&
    !models.some((model) => model.id === defaultModel)
  ) {
    models.unshift({ id: defaultModel, name: defaultModel });
  }
  return models;
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
