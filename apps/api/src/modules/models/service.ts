import { systemDb } from '@botsaas/database';

/** Modelos disponíveis para escolha no painel (tabela de preços ativa). */
export async function listAvailableModels() {
  const rows = await systemDb.modelPricing.findMany({
    where: { isActive: true },
    orderBy: { model: 'asc' },
    select: { model: true, displayName: true },
  });
  return rows.map((row) => ({ id: row.model, name: row.displayName ?? row.model }));
}
