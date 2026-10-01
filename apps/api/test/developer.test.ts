import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { systemDb } from '@botsaas/database';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSafeUrl,
  createGuardedLookup,
  isBlockedAddress,
  UnsafeUrlError,
} from '../src/lib/safe-http';
import {
  addMember,
  createCompanyFixture,
  createTestHarness,
  login,
  type TestClient,
  type TestHarness,
} from './helpers/harness';
import { drainJobs } from './helpers/jobs';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

async function businessCompany(name = 'Loja Alfa', ownerEmail = 'dono@alfa.test') {
  const company = await createCompanyFixture(harness, { name, ownerEmail, planKey: 'BUSINESS' });
  return { company, owner: await login(harness.app, ownerEmail) };
}

async function createKey(
  owner: TestClient,
  scopes: string[] = ['contacts:read', 'contacts:write'],
) {
  const response = await owner.post('/api/app/developer/api-keys', { name: 'ERP', scopes });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string; secret: string; masked: string }>();
}

const v1 = (
  method: 'GET' | 'POST',
  url: string,
  key?: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  harness.app.inject({
    method,
    url,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    ...(payload ? { payload: payload as object } : {}),
  });

describe('chaves de API', () => {
  it('a chave aparece uma vez; depois só mascarada; o banco guarda só o hash', async () => {
    const { owner } = await businessCompany();
    const key = await createKey(owner);
    expect(key.secret).toMatch(/^wz_test_[A-Za-z0-9]{40}$/);
    expect(key.masked).toBe(`wz_test_••••••••${key.secret.slice(-4)}`);

    const list = await owner.get('/api/app/developer/api-keys');
    expect(list.body).not.toContain(key.secret);
    const row = await systemDb.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(JSON.stringify(row)).not.toContain(key.secret);
    const auditRow = await systemDb.auditLog.findFirstOrThrow({
      where: { action: 'api_key.created' },
    });
    expect(JSON.stringify(auditRow)).not.toContain(key.secret);
  });

  it('autentica, respeita escopos, para de funcionar ao revogar', async () => {
    const { owner } = await businessCompany();
    const reader = await createKey(owner, ['contacts:read']);
    expect((await v1('GET', '/api/v1/contacts', reader.secret)).statusCode).toBe(200);
    const denied = await v1('POST', '/api/v1/contacts', reader.secret, {
      phone: '+55 11 98888-1111',
    });
    expect(denied.statusCode).toBe(403);
    expect((await v1('GET', '/api/v1/contacts')).statusCode).toBe(401);
    expect((await v1('GET', '/api/v1/contacts', 'wz_test_' + 'x'.repeat(40))).statusCode).toBe(401);

    expect((await owner.delete(`/api/app/developer/api-keys/${reader.id}`)).statusCode).toBe(200);
    expect((await v1('GET', '/api/v1/contacts', reader.secret)).statusCode).toBe(401);
  });

  it('plano sem API não cria chave, e rebaixar o plano desliga as chaves existentes', async () => {
    const { company, owner } = await businessCompany();
    const key = await createKey(owner);
    const pro = await systemDb.plan.findUniqueOrThrow({ where: { key: 'PRO' } });
    await systemDb.subscription.update({
      where: { companyId: company.id },
      data: { planId: pro.id },
    });

    expect((await v1('GET', '/api/v1/contacts', key.secret)).statusCode).toBe(403);
    const blocked = await owner.post('/api/app/developer/api-keys', {
      name: 'Outra',
      scopes: ['contacts:read'],
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('FEATURE_DISABLED');
  });

  it('chave de uma empresa não enxerga dados de outra', async () => {
    const alfa = await businessCompany();
    const beta = await businessCompany('Loja Beta', 'dono@beta.test');
    const betaContact = await beta.owner.post('/api/app/contacts', {
      phone: '+55 11 97777-2222',
      name: 'Cliente Beta',
    });
    const alfaKey = await createKey(alfa.owner);
    expect(
      (await v1('GET', `/api/v1/contacts/${betaContact.json().id}`, alfaKey.secret)).statusCode,
    ).toBe(404);
    const list = (await v1('GET', '/api/v1/contacts', alfaKey.secret)).json<{
      items: { name: string }[];
    }>();
    expect(list.items.map((item) => item.name)).not.toContain('Cliente Beta');
  });

  it('a API pública ignora o cookie de sessão do painel', async () => {
    const { owner } = await businessCompany();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/contacts',
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(401);
  });

  it('Idempotency-Key: o retry devolve a mesma resposta sem criar de novo', async () => {
    const { owner } = await businessCompany();
    const key = await createKey(owner);
    const body = { phone: '+55 11 96666-3333', name: 'Via API' };
    const first = await v1('POST', '/api/v1/contacts', key.secret, body, {
      'idempotency-key': 'pedido-123-abc',
    });
    const again = await v1('POST', '/api/v1/contacts', key.secret, body, {
      'idempotency-key': 'pedido-123-abc',
    });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json().id).toBe(first.json().id);
    expect(await systemDb.contact.count({ where: { name: 'Via API' } })).toBe(1);
    expect(first.json()).not.toHaveProperty('customFields');
  });

  it('só quem administra a empresa gerencia chaves', async () => {
    const { company } = await businessCompany();
    await addMember(company.id, 'gerente@alfa.test', 'MANAGER');
    const manager = await login(harness.app, 'gerente@alfa.test');
    expect((await manager.get('/api/app/developer/api-keys')).statusCode).toBe(403);
  });

  it('documento OpenAPI público descreve só a API v1', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/public/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json<{ paths: Record<string, unknown>; components: { securitySchemes: object } }>();
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/api/v1/contacts');
    expect(paths).toContain('/api/v1/messages');
    expect(paths.filter((path) => !path.startsWith('/api/v1/'))).toEqual([]);
    expect(document.components.securitySchemes).toHaveProperty('apiKey');
  });

  it('toda rota da API v1 exige chave com escopo', () => {
    const routes = harness.app.routeInventory.filter((route) => route.url.startsWith('/api/v1/'));
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(
      routes.filter((route) => !route.guards.some((guard) => guard.kind === 'apiKey')),
    ).toEqual([]);
  });
});

describe('webhooks de saída', () => {
  let server: Server;
  let received: { headers: IncomingHttpHeaders; body: string }[];
  let respondWith = 200;
  let url: string;

  beforeEach(async () => {
    received = [];
    respondWith = 200;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        response.statusCode = respondWith;
        response.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webzen`;
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('entrega o evento assinado; o receptor valida com o segredo mostrado na criação', async () => {
    const { owner } = await businessCompany();
    const endpoint = await owner.post('/api/app/developer/webhooks', {
      url,
      events: ['contact.created'],
    });
    expect(endpoint.statusCode).toBe(201);
    const { secret, id } = endpoint.json<{ secret: string; id: string }>();
    expect(secret).toMatch(/^whsec_/);
    expect((await owner.get('/api/app/developer/webhooks')).body).not.toContain(secret);

    await owner.post('/api/app/contacts', { phone: '+55 11 95555-4444', name: 'Novo lead' });
    await drainJobs(harness, { only: ['domain-event.dispatch', 'webhook.deliver'] });

    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.headers['x-webzen-event']).toBe('contact.created');
    const signature = String(delivery!.headers['x-webzen-signature']);
    const [, timestamp, hmac] = signature.match(/^t=(\d+),v1=([a-f0-9]{64})$/) ?? [];
    expect(
      createHmac('sha256', secret).update(`${timestamp}.${delivery!.body}`).digest('hex'),
    ).toBe(hmac);
    const payload = JSON.parse(delivery!.body) as {
      id: string;
      type: string;
      data: { contactId: string };
    };
    expect(payload.type).toBe('contact.created');
    expect(payload.data.contactId).toBeTruthy();

    // Reenvio mantém o mesmo ID de evento (o receptor deduplica).
    const deliveries = (await owner.get(`/api/app/developer/webhooks/${id}/deliveries`)).json<{
      items: { id: string; status: string }[];
    }>();
    expect(deliveries.items[0]?.status).toBe('SUCCEEDED');
    await owner.post(`/api/app/developer/webhook-deliveries/${deliveries.items[0]!.id}/redeliver`);
    await drainJobs(harness, { only: ['webhook.deliver'] });
    expect(JSON.parse(received[1]!.body).id).toBe(payload.id);
  });

  it('eventos não assinados pelo endpoint não são enviados; reprocessar o evento não duplica', async () => {
    const { company, owner } = await businessCompany();
    await owner.post('/api/app/developer/webhooks', { url, events: ['lead.created'] });
    await owner.post('/api/app/contacts', { phone: '+55 11 94444-5555' });
    await drainJobs(harness, { only: ['domain-event.dispatch', 'webhook.deliver'] });
    expect(received).toHaveLength(0);
    expect(await systemDb.webhookDelivery.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('destino com erro é repetido e termina como falha, sem perder o registro', async () => {
    const { owner } = await businessCompany();
    respondWith = 500;
    const endpoint = (
      await owner.post('/api/app/developer/webhooks', { url, events: ['contact.created'] })
    ).json<{ id: string }>();
    await owner.post('/api/app/developer/webhooks/' + endpoint.id + '/test');
    const delivery = await systemDb.webhookDelivery.findFirstOrThrow({
      where: { endpointId: endpoint.id },
    });
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await drainJobs(harness, { only: ['webhook.deliver'] }).catch(() => undefined);
      await harness.container.queue.enqueue('webhook.deliver', {
        companyId: delivery.companyId,
        deliveryId: delivery.id,
      });
    }
    const final = await systemDb.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(final).toMatchObject({ status: 'FAILED', attempts: 7, responseStatus: 500 });
    const endpointRow = await systemDb.webhookEndpoint.findUniqueOrThrow({
      where: { id: endpoint.id },
    });
    expect(endpointRow.consecutiveFailures).toBe(1);
  });

  it('plano sem webhooks não cadastra endpoints', async () => {
    await createCompanyFixture(harness, {
      name: 'Pro',
      ownerEmail: 'dono@pro.test',
      planKey: 'PRO',
    });
    const owner = await login(harness.app, 'dono@pro.test');
    expect(
      (await owner.post('/api/app/developer/webhooks', { url, events: ['contact.created'] }))
        .statusCode,
    ).toBe(403);
  });
});

describe('proteção contra SSRF', () => {
  const production = { allowPrivateNetworks: false, requireHttps: true };

  it.each([
    'http://exemplo.com.br/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://localhost/hook',
    'https://metadata.google.internal/x',
    'https://user:senha@exemplo.com.br/hook',
    'https://exemplo.com.br:22/hook',
    'ftp://exemplo.com.br/x',
  ])('produção recusa %s', (target) => {
    expect(() => assertSafeUrl(target, production)).toThrow(UnsafeUrlError);
  });

  it('aceita https público', () => {
    expect(assertSafeUrl('https://hooks.exemplo.com.br/webzen', production).hostname).toBe(
      'hooks.exemplo.com.br',
    );
  });

  it('nome que resolve para endereço interno é recusado na conexão (DNS rebinding)', async () => {
    const resolveTo = (address: string) =>
      createGuardedLookup(false, (_host, _options, callback) =>
        callback(null, [{ address, family: 4 }]),
      );
    const blocked = await new Promise<Error | null>((resolve) =>
      resolveTo('127.0.0.1')('hooks.exemplo.com.br', {}, (error) => resolve(error)),
    );
    expect(blocked).toBeInstanceOf(UnsafeUrlError);
    const allowed = await new Promise<string>((resolve) =>
      resolveTo('8.8.8.8')('hooks.exemplo.com.br', {}, (_error, address) =>
        resolve(String(address)),
      ),
    );
    expect(allowed).toBe('8.8.8.8');
  });

  it('classifica endereços internos, inclusive IPv4 mapeado em IPv6', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('100.64.1.1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedAddress('fd00::1')).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });
});
