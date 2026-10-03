import { systemDb } from '@botsaas/database';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCompanyFixture,
  createTestHarness,
  DEFAULT_PASSWORD,
  login,
  type TestHarness,
} from './helpers/harness';

/**
 * Abuso de autenticação e de custo. Cada teste sobe um app com limites pequenos
 * (o ambiente de teste padrão usa limites altos para não atrapalhar as outras suítes).
 */

const opened: TestHarness[] = [];
const originalEnv = { ...process.env };

async function harnessWith(overrides: Record<string, string>) {
  Object.assign(process.env, overrides);
  const harness = await createTestHarness();
  await harness.reset();
  opened.push(harness);
  return harness;
}

afterEach(async () => {
  while (opened.length > 0) await opened.pop()?.close();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function attemptLogin(
  harness: TestHarness,
  email: string,
  password: string,
  network: { remoteAddress?: string; forwardedFor?: string } = {},
) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      'x-requested-with': 'test',
      ...(network.forwardedFor ? { 'x-forwarded-for': network.forwardedFor } : {}),
    },
    ...(network.remoteAddress ? { remoteAddress: network.remoteAddress } : {}),
    payload: { email, password },
  });
}

describe('login: força bruta', () => {
  it('X-Forwarded-For forjado não burla o limite por IP (proxy não confiável por padrão)', async () => {
    const harness = await harnessWith({
      LOGIN_RATE_LIMIT_PER_MINUTE: '3',
      LOGIN_ACCOUNT_MAX_ATTEMPTS: '1000',
    });
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await attemptLogin(harness, `alvo${attempt}@x.com`, 'errada-123', {
        forwardedFor: `203.0.113.${attempt}`,
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('com proxy confiável configurado (TRUST_PROXY), usa o IP informado por ele', async () => {
    const harness = await harnessWith({
      TRUST_PROXY: '127.0.0.1',
      LOGIN_RATE_LIMIT_PER_MINUTE: '3',
      LOGIN_ACCOUNT_MAX_ATTEMPTS: '1000',
    });
    // Mesmo proxy confiável, clientes diferentes: cada um tem sua cota.
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await attemptLogin(harness, `alvo${attempt}@x.com`, 'errada-123', {
        remoteAddress: '127.0.0.1',
        forwardedFor: `203.0.113.${attempt}`,
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401]);
  });

  it('limita tentativas por CONTA mesmo vindo de IPs diferentes, sem afetar outras contas', async () => {
    const harness = await harnessWith({
      LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      LOGIN_ACCOUNT_MAX_ATTEMPTS: '3',
    });
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    await createCompanyFixture(harness, { name: 'Outra', ownerEmail: 'dono@outra.com' });

    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await attemptLogin(harness, 'dono@clinica.com', 'errada-123', {
        remoteAddress: `10.0.0.${attempt}`,
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401]);

    // Bloqueada: nem a senha certa entra, e o e-mail é normalizado (maiúsculas/espaços).
    const blocked = await attemptLogin(harness, '  DONO@clinica.com ', DEFAULT_PASSWORD, {
      remoteAddress: '10.0.0.99',
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.message).not.toMatch(/existe|cadastrad/i);

    const other = await attemptLogin(harness, 'dono@outra.com', DEFAULT_PASSWORD, {
      remoteAddress: '10.0.0.1',
    });
    expect(other.statusCode).toBe(200);
  });

  it('conta inexistente recebe a mesma resposta que conta existente (sem enumeração)', async () => {
    const harness = await harnessWith({
      LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
      LOGIN_ACCOUNT_MAX_ATTEMPTS: '2',
    });
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const results = [];
    for (const email of ['dono@clinica.com', 'ninguem@clinica.com']) {
      const responses = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const response = await attemptLogin(harness, email, 'errada-123', {
          remoteAddress: `10.1.0.${attempt}`,
        });
        responses.push([response.statusCode, response.json().error.message]);
      }
      results.push(responses);
    }
    expect(results[0]).toEqual(results[1]);
  });
});

describe('Testar agente: custo da IA', () => {
  it('limita chamadas por empresa por minuto', async () => {
    const harness = await harnessWith({ AI_TEST_RATE_LIMIT_PER_MINUTE: '2' });
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const owner = await login(harness.app, 'dono@clinica.com');

    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      harness.ai.enqueue({ text: 'Olá!' });
      statuses.push((await owner.post('/api/app/ai/test', { message: 'oi' })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
    expect(harness.ai.requests).toHaveLength(2);
  });

  it('respeita o orçamento da IA da empresa: sem orçamento, não chama o modelo', async () => {
    const harness = await harnessWith({ AI_TEST_RATE_LIMIT_PER_MINUTE: '100' });
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@clinica.com',
    });
    await systemDb.aIConfiguration.update({
      where: { companyId: company.id },
      data: { dailyBudgetUsd: 0.01 },
    });
    await systemDb.usageRecord.create({
      data: { companyId: company.id, kind: 'AI_CALL', costUsd: 0.02, isTest: true },
    });
    const owner = await login(harness.app, 'dono@clinica.com');

    const response = await owner.post('/api/app/ai/test', { message: 'oi' });
    expect(response.statusCode).toBe(429);
    expect(response.json().error.message).toMatch(/orçamento/i);
    expect(harness.ai.requests).toHaveLength(0);
  });
});
