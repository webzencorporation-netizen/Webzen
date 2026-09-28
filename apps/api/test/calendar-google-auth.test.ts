import { systemDb } from '@botsaas/database';
import { GoogleReauthorizationRequiredError } from '@botsaas/integrations';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireSecrets } from '../src/container';
import { systemScope } from '../src/lib/scope';
import { getAvailableSlots } from '../src/modules/calendar/service';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';

/**
 * Autorização do Google perdida (refresh token revogado/expirado) ou integração conectada
 * que não pode ser montada: a agenda recusa de forma visível, sem ignorar o Google em silêncio.
 */

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: 'fixture-client',
  GOOGLE_CLIENT_SECRET: 'fixture-secret',
  GOOGLE_REDIRECT_URI: 'https://app.invalid/api/integrations/google/callback',
};

let harness: TestHarness;

beforeAll(async () => {
  Object.assign(process.env, GOOGLE_ENV);
  harness = await createTestHarness();
});
afterAll(async () => {
  for (const key of Object.keys(GOOGLE_ENV)) delete process.env[key];
  await harness.close();
});
beforeEach(async () => harness.reset());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function companyWithGoogle() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  const company = await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'a@a.com' });
  await systemDb.company.update({
    where: { id: company.id },
    data: {
      businessHours: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        open: '09:00',
        close: '18:00',
        breaks: [],
      })),
    },
  });
  const secrets = requireSecrets(harness.container);
  await systemDb.integration.create({
    data: {
      companyId: company.id,
      provider: 'GOOGLE_CALENDAR',
      status: 'CONNECTED',
      config: { calendarId: 'primary' },
      credentialsEncrypted: secrets.encrypt(
        JSON.stringify({
          accessToken: 'expired',
          refreshToken: 'revoked',
          expiresAt: Date.now() - 1000,
        }),
      ),
    },
  });
  return company;
}

describe('Google Agenda sem autorização válida', () => {
  it('invalid_grant marca a integração com erro, avisa a equipe uma vez e recusa novas consultas', async () => {
    const company = await companyWithGoogle();
    const fetchMock = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const scope = systemScope(harness.container, company.id);

    await expect(getAvailableSlots(scope, { date: '2026-10-05' })).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError,
    );
    const integration = await systemDb.integration.findFirstOrThrow();
    expect(integration.status).toBe('ERROR');
    expect(integration.lastError).toMatch(/reconecte/);

    await expect(getAvailableSlots(scope, { date: '2026-10-05' })).rejects.toThrow(
      /desconectada.*reconecte/i,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const notifications = await systemDb.notification.findMany({
      where: { companyId: company.id, type: 'INTEGRATION_DISCONNECTED' },
    });
    expect(notifications).toHaveLength(1);
  });

  it('integração conectada sem configuração OAuth na instalação recusa em vez de ignorar o Google', async () => {
    const company = await companyWithGoogle();
    const container = {
      ...harness.container,
      env: { ...harness.container.env, GOOGLE_CLIENT_SECRET: undefined },
    };
    await expect(
      getAvailableSlots(systemScope(container, company.id), { date: '2026-10-05' }),
    ).rejects.toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('integração desconectada pelo usuário usa só a agenda interna', async () => {
    const company = await companyWithGoogle();
    await systemDb.integration.updateMany({
      data: { status: 'DISCONNECTED', credentialsEncrypted: null },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('rede não deveria ser usada');
      }),
    );
    const result = await getAvailableSlots(systemScope(harness.container, company.id), {
      date: '2026-10-05',
    });
    expect(result.slots.length).toBeGreaterThan(0);
  });
});
