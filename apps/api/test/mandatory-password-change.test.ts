import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCompanyFixture,
  createTestHarness,
  createUser,
  DEFAULT_PASSWORD,
  login,
  type TestHarness,
} from './helpers/harness';
import { inboundText, postWebhook } from './helpers/whatsapp';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());

const EMAIL = 'temporary@example.test';
const NEW_PASSWORD = 'senha-definitiva-321';

async function setup(kind: 'company' | 'platform', mustChangePassword = true) {
  const company = await createCompanyFixture(harness, {
    name: 'Empresa Senha Temporária',
    ownerEmail: kind === 'company' ? EMAIL : 'company-owner@example.test',
  });
  if (kind === 'platform') {
    await createUser({ email: EMAIL, platformRole: 'PLATFORM_OWNER' });
  }
  const user = await systemDb.user.update({
    where: { email: EMAIL },
    data: { mustChangePassword },
  });
  const client = await login(harness.app, EMAIL);
  return {
    company,
    user,
    client,
    protectedPath: kind === 'company' ? '/api/app/contacts' : '/api/platform/companies',
  };
}

function expectPasswordRequired(response: { statusCode: number; json(): unknown }) {
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({
    error: {
      code: 'AUTHORIZATION_ERROR',
      message: expect.stringMatching(/senha/i),
      details: { reason: 'PASSWORD_CHANGE_REQUIRED' },
    },
  });
}

describe('troca obrigatória da senha temporária no servidor', () => {
  it.each(['company', 'platform'] as const)(
    '%s: permite me e bloqueia leitura/escrita empresarial ou administrativa',
    async (kind) => {
      const { client, protectedPath } = await setup(kind);
      const me = await client.get('/api/auth/me?refresh=true');
      expect(me.statusCode).toBe(200);
      expect(me.json().user.mustChangePassword).toBe(true);
      // Um cookie provisório antigo não impede autenticar novamente.
      expect(
        (await client.post('/api/auth/login', { email: EMAIL, password: DEFAULT_PASSWORD }))
          .statusCode,
      ).toBe(200);
      expectPasswordRequired(await client.get(protectedPath));
      if (kind === 'company') {
        expectPasswordRequired(
          await client.post('/api/app/contacts', { phone: '5511999991111', name: 'Bloqueado' }),
        );
        expect(await systemDb.contact.count()).toBe(0);
      } else {
        expectPasswordRequired(await client.post('/api/platform/companies', {}));
        expect(await systemDb.company.count()).toBe(1);
      }
    },
  );

  it('bloqueia troca de empresa mesmo com associação válida e não altera a sessão', async () => {
    const { client, company, user } = await setup('company');
    const session = await systemDb.session.findFirstOrThrow({ where: { userId: user.id } });
    expectPasswordRequired(
      await client.post('/api/auth/switch-company', { companyId: company.id }),
    );
    expect(await systemDb.session.findUnique({ where: { id: session.id } })).toEqual(session);
  });

  it('bloqueia início do suporte para administrador com senha temporária', async () => {
    const { client, company, user } = await setup('platform');
    expectPasswordRequired(
      await client.post(`/api/platform/companies/${company.id}/support`, {
        reason: 'Inspecionar atendimento',
      }),
    );
    expect(await systemDb.session.findFirst({ where: { userId: user.id } })).toMatchObject({
      supportCompanyId: null,
    });
    expect(await systemDb.auditLog.count({ where: { action: 'support_mode.started' } })).toBe(0);
  });

  it('revalida a exigência em sessão e suporte já ativos', async () => {
    const { client, company, user } = await setup('platform', false);
    expect(
      (
        await client.post(`/api/platform/companies/${company.id}/support`, {
          reason: 'Suporte autorizado',
        })
      ).statusCode,
    ).toBe(200);
    expect((await client.get('/api/app/contacts')).statusCode).toBe(200);
    await systemDb.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    expectPasswordRequired(await client.get('/api/app/contacts'));
    expectPasswordRequired(await client.get('/api/platform/companies'));
    expect((await client.get('/api/auth/me')).json().user.mustChangePassword).toBe(true);
  });

  it.each(['company', 'platform'] as const)(
    '%s: troca correta libera a sessão, invalida outras e recusa a senha antiga',
    async (kind) => {
      const { client, protectedPath, user } = await setup(kind);
      const otherSession = await login(harness.app, EMAIL);
      expect(
        (
          await client.post('/api/auth/change-password', {
            currentPassword: 'senha-errada',
            newPassword: NEW_PASSWORD,
          })
        ).statusCode,
      ).toBe(400);
      expectPasswordRequired(await client.get(protectedPath));
      expect(
        (
          await client.post('/api/auth/change-password', {
            currentPassword: DEFAULT_PASSWORD,
            newPassword: DEFAULT_PASSWORD,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await client.post('/api/auth/change-password', {
            currentPassword: DEFAULT_PASSWORD,
            newPassword: NEW_PASSWORD,
          })
        ).statusCode,
      ).toBe(200);
      expect((await client.get('/api/auth/me')).json().user.mustChangePassword).toBe(false);
      expect((await client.get(protectedPath)).statusCode).toBe(200);
      expect((await otherSession.get('/api/auth/me')).statusCode).toBe(401);
      const oldLogin = await harness.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-requested-with': 'test' },
        payload: { email: EMAIL, password: DEFAULT_PASSWORD },
      });
      expect(oldLogin.statusCode).toBe(401);
      const fresh = await login(harness.app, EMAIL, NEW_PASSWORD);
      expect((await fresh.get(protectedPath)).statusCode).toBe(200);
      expect(
        await systemDb.auditLog.count({
          where: { action: 'user.password_changed', resourceId: user.id },
        }),
      ).toBe(1);
    },
  );

  it('preserva logout, health e webhooks públicos', async () => {
    const { client } = await setup('company');
    expect((await client.get('/health')).statusCode).toBe(200);
    expect((await client.get('/health/ready')).statusCode).toBe(200);
    expect(
      (
        await client.get(
          '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=123',
        )
      ).statusCode,
    ).toBe(200);
    const signed = await postWebhook(
      harness,
      inboundText('unknown-number', '5511999991111', 'Olá'),
    );
    expect(signed.statusCode).toBe(200);
    expect((await client.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
    expect((await client.post('/api/auth/logout')).statusCode).toBe(200);
  });

  it('não deixa callback OAuth contornar a troca obrigatória', async () => {
    const { client } = await setup('company');
    expectPasswordRequired(
      await client.get('/api/integrations/google/callback?error=access_denied'),
    );
    expect(await systemDb.integration.count()).toBe(0);
  });
});
