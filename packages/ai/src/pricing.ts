import type { AIUsage } from './provider/types';

export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
}

/**
 * Valores INICIAIS para a tabela ModelPricing (USD por milhão de tokens), conforme a
 * documentação da Anthropic consultada em set/2026. Preços mudam: a fonte de verdade é a
 * tabela no banco, editável na área da plataforma. Escrita de cache = TTL de 5 minutos.
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPrice & { displayName: string }> = {
  'claude-opus-5': {
    displayName: 'Claude Opus 5',
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    cacheWriteUsdPerMTok: 6.25,
    cacheReadUsdPerMTok: 0.5,
  },
  'claude-opus-5-5': {
    displayName: 'Claude Opus 5.5',
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    cacheWriteUsdPerMTok: 5,
    cacheReadUsdPerMTok: 0.2,
  },
  'claude-sonnet-5': {
    displayName: 'Claude Sonnet 5',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheWriteUsdPerMTok: 2.5,
    cacheReadUsdPerMTok: 0.2,
  },
  'claude-haiku-4-5': {
    displayName: 'Claude Haiku 4.5',
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    cacheWriteUsdPerMTok: 1.25,
    cacheReadUsdPerMTok: 0.1,
  },
  'claude-fable-5-1': {
    displayName: 'Claude Fable 5.1',
    inputUsdPerMTok: 10,
    outputUsdPerMTok: 50,
    cacheWriteUsdPerMTok: 12.5,
    cacheReadUsdPerMTok: 0.25,
  },
  'claude-opus-4-8': {
    displayName: 'Claude Opus 4.8',
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    cacheWriteUsdPerMTok: 6.25,
    cacheReadUsdPerMTok: 0.5,
  },
  'claude-sonnet-4-6': {
    displayName: 'Claude Sonnet 4.6',
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    cacheWriteUsdPerMTok: 3.75,
    cacheReadUsdPerMTok: 0.3,
  },
};

/**
 * Custo estimado. Na Messages API, `input_tokens` NÃO inclui os tokens lidos/escritos
 * em cache — por isso cada parcela é somada separadamente.
 */
export function estimateCostUsd(usage: AIUsage, price: ModelPrice | null | undefined): number {
  if (!price) return 0;
  const cost =
    usage.inputTokens * price.inputUsdPerMTok +
    usage.outputTokens * price.outputUsdPerMTok +
    usage.cacheWriteTokens * price.cacheWriteUsdPerMTok +
    usage.cacheReadTokens * price.cacheReadUsdPerMTok;
  return Math.round((cost / 1_000_000) * 1e6) / 1e6;
}
