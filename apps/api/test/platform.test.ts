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
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());

describe('área da plataforma', () => {
  it('cria empresa com template, dono, plano e configuração do agente', async () => {
    await createUser({ email: 'admin@plataforma.com', platformRole: 'PLATFORM_ADMIN' });
    const admin = await login(harness.app, 'admin@plataforma.com');

    const response = await admin.post('/api/platform/companies', {
      name: 'Clínica Bella',
      templateKey: 'CLINIC',
      timezone: 'America/Sao_Paulo',
      planKey: 'PRO',
      owner: { email: 'bella@clinica.com', name: 'Dra. Bella' },
    });
    expect(response.statusCode).toBe(201);
    const { company, ownerTemporaryPassword } = response.json();
    expect(company.slug).toBe('clinica-bella');
    expect(ownerTemporaryPassword).toEqual(expect.any(String));

    const [config, tools, stages, fields, subscription, member] = await Promise.all([
      systemDb.aIConfiguration.findUnique({ where: { companyId: company.id } }),
      systemDb.aIToolConfiguration.findMany({ where: { companyId: company.id, enabled: true } }),
      systemDb.leadStage.findMany({ where: { companyId: company.id } }),
      systemDb.customFieldDefinition.findMany({ where: { companyId: company.id } }),
      systemDb.subscription.findUnique({
        where: { companyId: company.id },
        include: { plan: true },
      }),
      systemDb.companyMember.findFirst({
        where: { companyId: company.id },
        include: { user: true },
      }),
    ]);
    expect(config?.enabled).toBe(false);
    expect(config?.agentName).toBe('Recepção');
    expect(tools.map((tool) => tool.toolName)).toContain('create_appointment');
    expect(stages.map((stage) => stage.key)).toContain('QUALIFICADO');
    expect(fields.map((field) => field.key)).toContain('procedimento');
    expect(subscription?.plan.key).toBe('PRO');
    expect(member?.role).toBe('COMPANY_OWNER');
    expect(member?.user.mustChangePassword).toBe(true);

    const owner = await login(harness.app, 'bella@clinica.com', ownerTemporaryPassword);
    expect((await owner.get('/api/auth/me')).json().activeCompany.name).toBe('Clínica Bella');

    const audit = await systemDb.auditLog.findFirst({
      where: { companyId: company.id, action: 'company.created' },
    });
    expect(audit).not.toBeNull();
  });

  it('lista empresas com status, suspende e reativa', async () => {
    await createUser({ email: 'admin@plataforma.com', platformRole: 'PLATFORM_ADMIN' });
    const company = await createCompanyFixture(harness, {
      name: 'Loja X',
      ownerEmail: 'x@x.com',
      templateKey: 'RETAIL_STORE',
    });
    const admin = await login(harness.app, 'admin@plataforma.com');

    const list = await admin.get('/api/platform/companies?search=loja');
    expect(list.json().items).toEqual([
      expect.objectContaining({
        name: 'Loja X',
        whatsapp: 'NOT_CONFIGURED',
        plan: expect.objectContaining({ key: 'PRO' }),
      }),
    ]);

    const owner = await login(harness.app, 'x@x.com');
    expect(
      (
        await admin.post(`/api/platform/companies/${company.id}/status`, {
          status: 'SUSPENDED',
          reason: 'teste',
        })
      ).statusCode,
    ).toBe(200);
    expect((await owner.get('/api/app/contacts')).statusCode).toBe(403);
    await admin.post(`/api/platform/companies/${company.id}/status`, { status: 'ACTIVE' });
    expect((await owner.get('/api/app/contacts')).statusCode).toBe(200);
  });

  it('modo suporte dá acesso auditado à empresa', async () => {
    await createUser({ email: 'admin@plataforma.com', platformRole: 'PLATFORM_ADMIN' });
    const company = await createCompanyFixture(harness, { name: 'Loja X', ownerEmail: 'x@x.com' });
    const admin = await login(harness.app, 'admin@plataforma.com');
    expect((await admin.get('/api/app/contacts')).statusCode).toBe(403);

    const started = await admin.post(`/api/platform/companies/${company.id}/support`, {
      reason: 'Chamado #123',
    });
    expect(started.statusCode).toBe(200);
    expect((await admin.get('/api/app/contacts')).statusCode).toBe(200);
    expect((await admin.get('/api/auth/me')).json().supportMode.companyId).toBe(company.id);

    await admin.delete('/api/platform/support');
    expect((await admin.get('/api/app/contacts')).statusCode).toBe(403);
    const logs = await systemDb.auditLog.findMany({
      where: { companyId: company.id, action: { startsWith: 'support_mode' } },
    });
    expect(logs.map((log) => log.action).sort()).toEqual([
      'support_mode.ended',
      'support_mode.started',
    ]);
  });

  it('altera limites e reflete no estado de consumo', async () => {
    await createUser({ email: 'admin@plataforma.com', platformRole: 'PLATFORM_ADMIN' });
    const company = await createCompanyFixture(harness, { name: 'Loja X', ownerEmail: 'x@x.com' });
    const admin = await login(harness.app, 'admin@plataforma.com');
    const response = await admin.put(`/api/platform/companies/${company.id}/limits`, {
      limits: [{ metric: 'USERS', limitValue: 1 }],
    });
    expect(response.statusCode).toBe(200);
    const detail = (await admin.get(`/api/platform/companies/${company.id}`)).json();
    const users = detail.usage.metrics.find(
      (metric: { metric: string }) => metric.metric === 'USERS',
    );
    expect(users).toMatchObject({ current: 1, limit: 1, state: 'LIMIT_REACHED' });
  });
});
