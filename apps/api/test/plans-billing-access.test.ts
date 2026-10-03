import { systemDb } from '@botsaas/database';
import { DEFAULT_PLANS } from '@botsaas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { checkUsageAlerts } from '../src/modules/usage/alerts';
import { checkAiAllowance } from '../src/modules/usage/limits';
import { seedReferenceData, stripePriceIdsFromEnv } from '../src/seed/reference';
import {
  createCompanyFixture,
  createTestHarness,
  createUser,
  login,
  type TestHarness,
} from './helpers/harness';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

const automation = (name: string, isActive = true) => ({
  name,
  trigger: 'contact.created',
  conditions: [],
  actions: [{ type: 'add_tag', tagName: 'novo' }],
  isActive,
});

describe('catálogo central de planos', () => {
  it('a página pública lista os planos à venda com preço anual e economia, sem IDs da Stripe', async () => {
    await systemDb.plan.update({
      where: { key: 'PRO' },
      data: { stripePriceMonthlyId: 'price_proMensal', stripePriceYearlyId: 'price_proAnual' },
    });
    await systemDb.plan.create({
      data: { key: 'INTERNO', name: 'Interno', limits: {}, isPublic: false },
    });

    const response = await harness.app.inject({ method: 'GET', url: '/api/public/plans' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('price_pro');
    const { plans } = response.json<{
      plans: {
        key: string;
        priceMonthlyCents: number;
        priceYearlyCents: number;
        yearlySavings: { cents: number; percent: number };
        features: { flag: string; label: string }[];
      }[];
    }>();
    expect(plans.map((plan) => plan.key)).toEqual(['STARTER', 'PRO', 'BUSINESS']);
    expect(plans.map((plan) => [plan.priceMonthlyCents, plan.priceYearlyCents])).toEqual([
      [25_000, 250_000],
      [45_000, 450_000],
      [75_000, 750_000],
    ]);
    // 12 × R$ 250 − R$ 2.500 = R$ 500 de economia (~2 meses).
    expect(plans[0]?.yearlySavings).toEqual({ cents: 50_000, percent: 17 });
    expect(plans[2]?.features.map((feature) => feature.flag)).toContain('API_ACCESS');
    expect(plans[0]?.features.map((feature) => feature.flag)).not.toContain('API_ACCESS');
  });

  it('cada plano libera estritamente mais que o anterior', () => {
    for (let index = 1; index < DEFAULT_PLANS.length; index += 1) {
      const previous = DEFAULT_PLANS[index - 1]!;
      const current = DEFAULT_PLANS[index]!;
      expect(current.priceMonthlyCents).toBeGreaterThan(previous.priceMonthlyCents);
      for (const feature of previous.features) expect(current.features).toContain(feature);
      expect(current.features.length).toBeGreaterThan(previous.features.length);
      for (const [metric, limit] of Object.entries(previous.limits)) {
        const next = current.limits[metric as keyof typeof current.limits];
        if (limit !== null) expect(next === null || next > limit).toBe(true);
      }
    }
  });

  it('seed não sobrescreve ajustes do administrador; --sync-plans reaplica o catálogo', async () => {
    await systemDb.plan.update({ where: { key: 'STARTER' }, data: { priceMonthlyCents: 1 } });
    await seedReferenceData();
    expect(
      (await systemDb.plan.findUniqueOrThrow({ where: { key: 'STARTER' } })).priceMonthlyCents,
    ).toBe(1);

    await seedReferenceData({ syncPlans: true });
    const starter = await systemDb.plan.findUniqueOrThrow({ where: { key: 'STARTER' } });
    expect(starter.priceMonthlyCents).toBe(25_000);
    expect(starter.priceYearlyCents).toBe(250_000);
  });

  it('IDs de preço da Stripe vêm do ambiente e são validados', async () => {
    await seedReferenceData({ env: { STRIPE_PRICE_BUSINESS_YEARLY: 'price_bizAnual' } });
    const business = await systemDb.plan.findUniqueOrThrow({ where: { key: 'BUSINESS' } });
    expect(business.stripePriceYearlyId).toBe('price_bizAnual');
    expect(() => stripePriceIdsFromEnv('PRO', { STRIPE_PRICE_PRO_MONTHLY: 'prod_errado' })).toThrow(
      /STRIPE_PRICE_PRO_MONTHLY/,
    );
  });

  it('PATCH parcial de plano não reativa plano desativado', async () => {
    await createUser({ email: 'root@plataforma.local', platformRole: 'PLATFORM_OWNER' });
    const admin = await login(harness.app, 'root@plataforma.local');
    const plan = await systemDb.plan.update({
      where: { key: 'STARTER' },
      data: { isActive: false },
    });

    const response = await admin.patch(`/api/platform/plans/${plan.id}`, { name: 'Starter 2' });
    expect(response.statusCode).toBe(200);
    const after = await systemDb.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after).toMatchObject({ name: 'Starter 2', isActive: false });
  });

  it('limites de plano só aceitam métricas conhecidas', async () => {
    await createUser({ email: 'root@plataforma.local', platformRole: 'PLATFORM_OWNER' });
    const admin = await login(harness.app, 'root@plataforma.local');
    const plan = await systemDb.plan.findUniqueOrThrow({ where: { key: 'PRO' } });
    const response = await admin.patch(`/api/platform/plans/${plan.id}`, {
      limits: { MENSAGENS_POR_MES: 10 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('assinatura e acesso à IA', () => {
  it('assinatura inativa bloqueia a IA; PAST_DUE mantém; trial expirado bloqueia', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Loja',
      ownerEmail: 'a@loja.test',
    });
    const scope = systemScope(harness.container, company.id);

    expect((await checkAiAllowance(scope)).allowed).toBe(true);

    await systemDb.subscription.update({
      where: { companyId: company.id },
      data: { status: 'PAST_DUE' },
    });
    expect((await checkAiAllowance(scope)).allowed).toBe(true);

    await systemDb.subscription.update({
      where: { companyId: company.id },
      data: { status: 'CANCELLED' },
    });
    expect(await checkAiAllowance(scope)).toEqual({
      allowed: false,
      reason: expect.stringContaining('cancelada'),
    });

    await systemDb.subscription.update({
      where: { companyId: company.id },
      data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000) },
    });
    expect((await checkAiAllowance(scope)).allowed).toBe(false);
  });

  it('empresa sem assinatura (gerida manualmente) mantém o comportamento anterior', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Legado',
      ownerEmail: 'b@legado.test',
    });
    await systemDb.subscription.delete({ where: { companyId: company.id } });
    expect((await checkAiAllowance(systemScope(harness.container, company.id))).allowed).toBe(true);
  });

  it('o "Testar agente" respeita a assinatura inativa', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'c@clinica.test',
    });
    await systemDb.subscription.update({
      where: { companyId: company.id },
      data: { status: 'UNPAID' },
    });
    const owner = await login(harness.app, 'c@clinica.test');
    const response = await owner.post('/api/app/ai/test', { message: 'Oi, quanto custa?' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(harness.ai.requests.length).toBe(0);
  });
});

describe('avisos de consumo 70/90/100%', () => {
  it('avisa em cada limiar uma única vez por mês', async () => {
    const company = await createCompanyFixture(harness, { name: 'Pet', ownerEmail: 'd@pet.test' });
    await systemDb.usageLimit.create({
      data: { companyId: company.id, metric: 'AI_CALLS_PER_MONTH', limitValue: 10 },
    });
    const usage = (count: number) =>
      systemDb.usageRecord.createMany({
        data: Array.from({ length: count }, () => ({
          companyId: company.id,
          kind: 'AI_CALL' as const,
        })),
      });

    await usage(7);
    expect((await checkUsageAlerts(harness.container)).created).toBe(1);
    expect((await checkUsageAlerts(harness.container)).created).toBe(0);

    await usage(3);
    await checkUsageAlerts(harness.container);
    const notifications = await systemDb.notification.findMany({
      where: { companyId: company.id, type: { in: ['USAGE_WARNING', 'USAGE_LIMIT_REACHED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      notifications.map((item) => [item.type, (item.data as { threshold: number }).threshold]),
    ).toEqual([
      ['USAGE_WARNING', 70],
      ['USAGE_LIMIT_REACHED', 100],
    ]);
    expect(notifications[1]?.body).toContain('10 de 10');
  });
});

describe('limite de automações por plano', () => {
  it('Starter permite 3 automações ativas; inativas não contam', async () => {
    await createCompanyFixture(harness, {
      name: 'Bar',
      ownerEmail: 'e@bar.test',
      planKey: 'STARTER',
    });
    const owner = await login(harness.app, 'e@bar.test');
    for (const name of ['Regra A', 'Regra B', 'Regra C']) {
      expect((await owner.post('/api/app/automations', automation(name))).statusCode).toBe(201);
    }
    const blocked = await owner.post('/api/app/automations', automation('Regra D'));
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().error.code).toBe('LIMIT_REACHED');

    const inactive = await owner.post('/api/app/automations', automation('Regra E', false));
    expect(inactive.statusCode).toBe(201);
    const activate = await owner.patch(`/api/app/automations/${inactive.json().id}`, {
      isActive: true,
    });
    expect(activate.statusCode).toBe(402);
  });
});
