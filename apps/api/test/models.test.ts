import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { effectiveModel, listAvailableModels } from '../src/modules/models/service';
import { createTestHarness, type TestHarness } from './helpers/harness';

/** Catálogo de modelos por provedor e modelo efetivo quando a plataforma troca de provedor. */

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

describe('catálogo de modelos', () => {
  it('mostra só os modelos do provedor ativo; o mock mostra todos', async () => {
    const meta = (await listAvailableModels('meta')).map((model) => model.id);
    expect(meta).toEqual(['muse-spark-1.3']);

    const anthropic = (await listAvailableModels('anthropic')).map((model) => model.id);
    expect(anthropic).toContain('claude-opus-5');
    expect(anthropic).not.toContain('muse-spark-1.3');

    const all = (await listAvailableModels('mock')).map((model) => model.id);
    expect(all).toEqual(expect.arrayContaining(['claude-opus-5', 'muse-spark-1.3']));
  });

  it('cadastra o Muse Spark 1.3 com os preços da Meta', async () => {
    const { systemDb } = await import('@botsaas/database');
    const row = await systemDb.modelPricing.findUniqueOrThrow({
      where: { model: 'muse-spark-1.3' },
    });
    expect({
      input: Number(row.inputUsdPerMTok),
      cacheRead: Number(row.cacheReadUsdPerMTok),
      output: Number(row.outputUsdPerMTok),
      active: row.isActive,
    }).toEqual({ input: 1.25, cacheRead: 0.15, output: 4.25, active: true });
  });
});

describe('modelo efetivo', () => {
  const meta = { AI_PROVIDER: 'meta' as const, AI_DEFAULT_MODEL: 'muse-spark-1.3' };

  it('modelo salvo de outro provedor cai no padrão da plataforma em vez de falhar', () => {
    expect(effectiveModel('claude-opus-5', meta)).toBe('muse-spark-1.3');
    expect(effectiveModel(null, meta)).toBe('muse-spark-1.3');
    expect(effectiveModel(undefined, meta)).toBe('muse-spark-1.3');
  });

  it('mantém o modelo escolhido pela empresa quando serve ao provedor ativo', () => {
    expect(effectiveModel('muse-spark-1.3', meta)).toBe('muse-spark-1.3');
    expect(
      effectiveModel('claude-sonnet-5', {
        AI_PROVIDER: 'anthropic',
        AI_DEFAULT_MODEL: 'claude-opus-5',
      }),
    ).toBe('claude-sonnet-5');
    expect(
      effectiveModel('claude-sonnet-5', { AI_PROVIDER: 'mock', AI_DEFAULT_MODEL: 'claude-opus-5' }),
    ).toBe('claude-sonnet-5');
  });
});
