import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANS,
  FEATURE_FLAGS,
  USAGE_METRICS,
  subscriptionGrantsAccess,
  usageThresholdReached,
  yearlySavings,
} from '../src';

describe('catálogo de planos', () => {
  it('todo plano define todas as métricas e só recursos conhecidos', () => {
    for (const plan of DEFAULT_PLANS) {
      expect(Object.keys(plan.limits).sort()).toEqual([...USAGE_METRICS].sort());
      for (const feature of plan.features) expect(FEATURE_FLAGS).toContain(feature);
    }
  });

  it('nenhum plano é gratuito e o anual dá ~2 meses de desconto', () => {
    for (const plan of DEFAULT_PLANS) {
      expect(plan.priceMonthlyCents).toBeGreaterThan(0);
      expect(plan.priceYearlyCents).toBe(plan.priceMonthlyCents * 10);
    }
  });
});

describe('usageThresholdReached', () => {
  it.each([
    [0, 100, 0],
    [69, 100, 0],
    [70, 100, 70],
    [89.9, 100, 70],
    [90, 100, 90],
    [100, 100, 100],
    [150, 100, 100],
    [5, null, 0],
    [0, 0, 100],
  ])('uso %s de %s → %s%%', (current, limit, expected) => {
    expect(usageThresholdReached(current, limit)).toBe(expected);
  });
});

describe('yearlySavings', () => {
  it('calcula a economia frente a 12 mensalidades', () => {
    expect(yearlySavings(45_000, 450_000)).toEqual({ cents: 90_000, percent: 17 });
  });
  it('sem anual ou sem desconto não há economia', () => {
    expect(yearlySavings(45_000, null)).toBeNull();
    expect(yearlySavings(45_000, 540_000)).toBeNull();
  });
});

describe('subscriptionGrantsAccess', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it.each([
    ['ACTIVE', true],
    ['PAST_DUE', true],
    ['UNPAID', false],
    ['INCOMPLETE', false],
    ['PAUSED', false],
    ['CANCELLED', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(subscriptionGrantsAccess({ status }, now)).toBe(expected);
  });

  it('trial vale até o fim do prazo', () => {
    const future = new Date('2026-10-08T12:00:00Z');
    const past = new Date('2026-09-30T12:00:00Z');
    expect(subscriptionGrantsAccess({ status: 'TRIALING', trialEndsAt: future }, now)).toBe(true);
    expect(subscriptionGrantsAccess({ status: 'TRIALING', trialEndsAt: past }, now)).toBe(false);
  });

  it('sem assinatura não há acesso pela regra (o chamador decide o legado)', () => {
    expect(subscriptionGrantsAccess(null, now)).toBe(false);
  });
});
