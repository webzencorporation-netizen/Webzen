import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const lastMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10));
};

describe('indicadores SaaS da plataforma', () => {
  it('MRR, ARR, assinantes, churn e receita vêm dos dados reais', async () => {
    const starter = await createCompanyFixture(harness, {
      name: 'A',
      ownerEmail: 'a@a.test',
      planKey: 'STARTER',
    });
    const pro = await createCompanyFixture(harness, {
      name: 'B',
      ownerEmail: 'b@b.test',
      planKey: 'PRO',
    });
    const pending = await createCompanyFixture(harness, {
      name: 'C',
      ownerEmail: 'c@c.test',
      planKey: 'BUSINESS',
    });
    const gone = await createCompanyFixture(harness, {
      name: 'D',
      ownerEmail: 'd@d.test',
      planKey: 'STARTER',
    });
    await systemDb.subscription.update({
      where: { companyId: starter.id },
      data: { createdAt: lastMonth() },
    });
    await systemDb.subscription.update({
      where: { companyId: pro.id },
      data: { interval: 'YEARLY', createdAt: lastMonth() },
    });
    await systemDb.subscription.update({
      where: { companyId: pending.id },
      data: { status: 'INCOMPLETE' },
    });
    await systemDb.subscription.update({
      where: { companyId: gone.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), createdAt: lastMonth() },
    });
    await systemDb.invoice.create({
      data: {
        companyId: pro.id,
        externalId: 'in_metric',
        status: 'PAID',
        amountDueCents: 450_000,
        amountPaidCents: 450_000,
        paidAt: new Date(),
        issuedAt: new Date(),
      },
    });

    await createUser({ email: 'root@webzen.test', platformRole: 'PLATFORM_OWNER' });
    const admin = await login(harness.app, 'root@webzen.test');
    const metrics = (await admin.get('/api/platform/metrics/saas')).json();

    expect(metrics.revenue).toMatchObject({
      mrrCents: 25_000 + 37_500,
      arrCents: (25_000 + 37_500) * 12,
      paidThisMonthCents: 450_000,
    });
    expect(metrics.subscriptions).toMatchObject({
      paying: 2,
      awaitingPayment: 1,
      cancelledThisMonth: 1,
    });
    // 1 cancelamento sobre 3 pagantes no início do mês.
    expect(metrics.subscriptions.churnRatePercent).toBe(33.3);
    expect(metrics.byPlan.map((plan: { key: string }) => plan.key)).toEqual(['PRO', 'STARTER']);
    expect(metrics.companies.newThisMonth).toBe(4);

    const economics = (await admin.get('/api/platform/metrics/economics')).json<
      { name: string; revenueCents: number }[]
    >();
    expect(economics.find((row) => row.name === 'B')?.revenueCents).toBe(450_000);
  });

  it('só administradores da plataforma veem os indicadores', async () => {
    await createCompanyFixture(harness, { name: 'E', ownerEmail: 'e@e.test' });
    const owner = await login(harness.app, 'e@e.test');
    expect((await owner.get('/api/platform/metrics/saas')).statusCode).toBe(403);
  });
});
