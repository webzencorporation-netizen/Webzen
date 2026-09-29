import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCompanyFixture,
  createTestHarness,
  createUser,
  login,
  type TestHarness,
} from './helpers/harness';

/**
 * Relatório de consumo da IA por dia, cliente e modelo — base para a WebZen saber quanto
 * cada cliente gasta. Custos/tokens vêm de UsageRecord; execuções, erros e latência de AgentRun.
 */

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

async function usage(
  companyId: string,
  at: string,
  model: string,
  costUsd: number,
  extra: { inputTokens?: number; outputTokens?: number; isTest?: boolean } = {},
) {
  await systemDb.usageRecord.create({
    data: {
      companyId,
      kind: 'AI_CALL',
      model,
      costUsd,
      inputTokens: extra.inputTokens ?? 100,
      outputTokens: extra.outputTokens ?? 10,
      isTest: extra.isTest ?? false,
      occurredAt: new Date(at),
    },
  });
}

async function run(
  companyId: string,
  at: string,
  model: string,
  provider: string,
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED',
  durationMs: number,
  trigger: 'INBOUND_MESSAGE' | 'TEST_CHAT' = 'INBOUND_MESSAGE',
) {
  await systemDb.agentRun.create({
    data: { companyId, model, provider, status, durationMs, trigger, startedAt: new Date(at) },
  });
}

async function seed() {
  const bella = await createCompanyFixture(harness, {
    name: 'Clínica Bella',
    ownerEmail: 'bella@clinica.com',
  });
  const outra = await createCompanyFixture(harness, {
    name: 'Barbearia Outra',
    ownerEmail: 'dono@outra.com',
  });
  // 10/09 09:00 em São Paulo
  await usage(bella.id, '2026-09-10T12:00:00Z', 'claude-opus-5', 0.1, {
    inputTokens: 1000,
    outputTokens: 100,
  });
  await run(bella.id, '2026-09-10T12:00:00Z', 'claude-opus-5', 'anthropic', 'SUCCEEDED', 2000);
  // 09/09 23:30 em São Paulo (em UTC já é 10/09)
  await usage(bella.id, '2026-09-10T02:30:00Z', 'muse-spark-1.3', 0.02);
  await run(bella.id, '2026-09-10T02:30:00Z', 'muse-spark-1.3', 'meta', 'FAILED', 4000);
  // Fora da conta: teste do painel, execução pulada e registro fora do período.
  await usage(bella.id, '2026-09-11T12:00:00Z', 'muse-spark-1.3', 0.5, { isTest: true });
  await run(
    bella.id,
    '2026-09-11T12:00:00Z',
    'muse-spark-1.3',
    'meta',
    'SUCCEEDED',
    9000,
    'TEST_CHAT',
  );
  await run(bella.id, '2026-09-11T13:00:00Z', 'muse-spark-1.3', 'meta', 'SKIPPED', 0);
  await usage(bella.id, '2026-10-02T12:00:00Z', 'muse-spark-1.3', 9);
  // Outro cliente
  await usage(outra.id, '2026-09-10T15:00:00Z', 'muse-spark-1.3', 0.05);
  await run(outra.id, '2026-09-10T15:00:00Z', 'muse-spark-1.3', 'meta', 'SUCCEEDED', 1000);
  return { bella, outra };
}

const RANGE = 'from=2026-09-01&to=2026-09-30';

describe('relatório de consumo da IA — plataforma', () => {
  it('agrega por dia (fuso de São Paulo), cliente e modelo, com erros e latência', async () => {
    const { bella, outra } = await seed();
    await createUser({ email: 'admin@webzen.com', platformRole: 'PLATFORM_ADMIN' });
    const admin = await login(harness.app, 'admin@webzen.com');

    const response = await admin.get(`/api/platform/usage/breakdown?${RANGE}`);
    expect(response.statusCode).toBe(200);
    const report = response.json();

    expect(report).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      timezone: 'America/Sao_Paulo',
    });
    expect(report.totals).toMatchObject({ calls: 3, runs: 3, failedRuns: 1 });
    expect(report.totals.costUsd).toBeCloseTo(0.17, 6);

    expect(report.byDay).toEqual([
      expect.objectContaining({ day: '2026-09-09', calls: 1, runs: 1, failedRuns: 1 }),
      expect.objectContaining({ day: '2026-09-10', calls: 2, runs: 2, failedRuns: 0 }),
    ]);

    const byCompany = Object.fromEntries(
      report.byCompany.map((row: { companyId: string }) => [row.companyId, row]),
    );
    expect(byCompany[bella.id]).toMatchObject({
      companyName: 'Clínica Bella',
      calls: 2,
      inputTokens: 1100,
      outputTokens: 110,
      runs: 2,
      failedRuns: 1,
      errorRate: 0.5,
      avgDurationMs: 3000,
    });
    expect(byCompany[bella.id].costUsd).toBeCloseTo(0.12, 6);
    expect(byCompany[outra.id]).toMatchObject({ companyName: 'Barbearia Outra', calls: 1 });
    // Mais caro primeiro.
    expect(report.byCompany[0].companyId).toBe(bella.id);

    const byModel = Object.fromEntries(
      report.byModel.map((row: { model: string }) => [row.model, row]),
    );
    expect(byModel['claude-opus-5']).toMatchObject({ provider: 'anthropic', calls: 1, runs: 1 });
    expect(byModel['muse-spark-1.3']).toMatchObject({
      provider: 'meta',
      calls: 2,
      runs: 2,
      failedRuns: 1,
    });
    expect(byModel['muse-spark-1.3'].costUsd).toBeCloseTo(0.07, 6);
  });

  it('filtra por cliente e valida o período', async () => {
    const { outra } = await seed();
    await createUser({ email: 'admin@webzen.com', platformRole: 'PLATFORM_ADMIN' });
    const admin = await login(harness.app, 'admin@webzen.com');

    const filtered = (
      await admin.get(`/api/platform/usage/breakdown?${RANGE}&companyId=${outra.id}`)
    ).json();
    expect(filtered.totals).toMatchObject({ calls: 1, runs: 1 });
    expect(filtered.byCompany.map((row: { companyId: string }) => row.companyId)).toEqual([
      outra.id,
    ]);

    expect(
      (await admin.get('/api/platform/usage/breakdown?from=2026-09-30&to=2026-09-01')).statusCode,
    ).toBe(400);
    expect(
      (await admin.get('/api/platform/usage/breakdown?from=2025-01-01&to=2026-09-30')).statusCode,
    ).toBe(400);
  });

  it('usuário de empresa não acessa o relatório da plataforma', async () => {
    await seed();
    const owner = await login(harness.app, 'bella@clinica.com');
    expect((await owner.get(`/api/platform/usage/breakdown?${RANGE}`)).statusCode).toBe(403);
  });
});

describe('relatório de consumo da IA — empresa', () => {
  it('mostra só a própria empresa, sem recorte por cliente', async () => {
    await seed();
    const owner = await login(harness.app, 'bella@clinica.com');

    const response = await owner.get(`/api/app/metrics/usage/breakdown?${RANGE}`);
    expect(response.statusCode).toBe(200);
    const report = response.json();
    expect(report.totals).toMatchObject({ calls: 2, runs: 2, failedRuns: 1 });
    expect(report.totals.costUsd).toBeCloseTo(0.12, 6);
    expect(report).not.toHaveProperty('byCompany');
    expect(report.byModel.map((row: { model: string }) => row.model).sort()).toEqual([
      'claude-opus-5',
      'muse-spark-1.3',
    ]);
    expect(JSON.stringify(report)).not.toContain('Barbearia Outra');
  });
});
