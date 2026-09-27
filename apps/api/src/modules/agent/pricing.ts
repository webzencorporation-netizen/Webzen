import { DEFAULT_MODEL_PRICING, estimateCostUsd, type AIUsage, type ModelPrice } from '@botsaas/ai';
import { decimalToNumber, systemDb } from '@botsaas/database';

const CACHE_TTL_MS = 60_000;
let cache: { at: number; prices: Map<string, ModelPrice> } | null = null;

/** Preços por modelo (tabela ModelPricing, editável; fallback nos valores iniciais). */
export async function getModelPrice(model: string): Promise<ModelPrice | null> {
  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    const rows = await systemDb.modelPricing.findMany({ where: { isActive: true } });
    cache = {
      at: Date.now(),
      prices: new Map(
        rows.map((row) => [
          row.model,
          {
            inputUsdPerMTok: decimalToNumber(row.inputUsdPerMTok) ?? 0,
            outputUsdPerMTok: decimalToNumber(row.outputUsdPerMTok) ?? 0,
            cacheWriteUsdPerMTok: decimalToNumber(row.cacheWriteUsdPerMTok) ?? 0,
            cacheReadUsdPerMTok: decimalToNumber(row.cacheReadUsdPerMTok) ?? 0,
          },
        ]),
      ),
    };
  }
  return cache.prices.get(model) ?? DEFAULT_MODEL_PRICING[model] ?? null;
}

export function clearPricingCache(): void {
  cache = null;
}

export async function costFor(model: string, usage: AIUsage): Promise<number> {
  return estimateCostUsd(usage, await getModelPrice(model));
}
