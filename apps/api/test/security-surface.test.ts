import { randomUUID } from 'node:crypto';
import { systemDb } from '@botsaas/database';
import { LocalObjectStorage } from '@botsaas/integrations';
import { permissionsForRole } from '@botsaas/shared';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RouteInventoryEntry } from '../src/plugins/route-inventory';
import {
  addMember,
  createCompanyFixture,
  createTestHarness,
  createUser,
  login,
  type TestHarness,
} from './helpers/harness';

/**
 * Superfície de ataque inteira, a partir do inventário de endpoints (plugins/route-inventory).
 * Uma rota nova sem guard, ou um guard sem permissão numa escrita, quebra estes testes.
 */

let harness: TestHarness;
let routes: RouteInventoryEntry[];

beforeAll(async () => {
  harness = await createTestHarness();
  routes = harness.app.routeInventory;
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

/** Únicas rotas sem sessão: login/logout, callback OAuth (state assinado), health e webhook (HMAC). */
const PUBLIC_ROUTES = new Set([
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/integrations/google/callback',
  'GET /health',
  'GET /health/ready',
  'GET /webhooks/whatsapp',
  'POST /webhooks/whatsapp',
]);
/** Escritas sem permissão específica: só marcam notificações do PRÓPRIO usuário como lidas. */
const USER_SCOPED_WRITES = new Set([
  'POST /api/app/notifications/:id/read',
  'POST /api/app/notifications/read-all',
]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const key = (route: RouteInventoryEntry) => `${route.method} ${route.url}`;
const concreteUrl = (url: string) => url.replace(/:[A-Za-z]+/g, randomUUID());

function request(route: RouteInventoryEntry, cookie?: string): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method: route.method as InjectOptions['method'],
    url: concreteUrl(route.url),
    headers: {
      'x-requested-with': 'test',
      ...(cookie ? { cookie } : {}),
      ...(MUTATING.has(route.method) ? { 'content-type': 'application/json' } : {}),
    },
    ...(MUTATING.has(route.method) ? { payload: '{}' } : {}),
  };
  return harness.app.inject(options);
}

describe('inventário de endpoints: política de guards', () => {
  it('toda rota tem guard, salvo a lista pública explícita', () => {
    expect(routes.length).toBeGreaterThan(100);
    const unguarded = routes.filter((route) => route.guards.length === 0).map(key);
    expect(unguarded.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('painel da empresa exige empresa da sessão; escritas exigem permissão específica', () => {
    const app = routes.filter((route) => route.url.startsWith('/api/app/'));
    const withoutCompany = app.filter((route) => !route.guards.some((g) => g.kind === 'company'));
    expect(withoutCompany.map(key)).toEqual([]);
    const writesWithoutPermission = app
      .filter((route) => MUTATING.has(route.method) && !USER_SCOPED_WRITES.has(key(route)))
      .filter((route) => route.guards.some((g) => g.kind === 'company' && g.permission === null));
    expect(writesWithoutPermission.map(key)).toEqual([]);
  });

  it('área da plataforma exige papel de plataforma em toda rota', () => {
    const platform = routes.filter((route) => route.url.startsWith('/api/platform/'));
    expect(platform.length).toBeGreaterThan(20);
    expect(
      platform.filter((route) => !route.guards.some((g) => g.kind === 'platform')).map(key),
    ).toEqual([]);
  });
});

describe('autenticação em toda a superfície', () => {
  it('sem sessão: toda rota protegida responde 401', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((item) => !PUBLIC_ROUTES.has(key(item)))) {
      const response = await request(route);
      if (response.statusCode !== 401) failures.push(`${key(route)} → ${response.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('cookie de sessão inválido ou forjado é tratado como sem sessão', async () => {
    for (const cookie of ['sid=invalido', `sid=${'a'.repeat(64)}`, `sid=${'x'.repeat(500)}`]) {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('sessão expirada é recusada e removida', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const owner = await login(harness.app, 'dono@clinica.com');
    expect((await owner.get('/api/auth/me')).statusCode).toBe(200);
    await systemDb.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await owner.get('/api/auth/me')).statusCode).toBe(401);
    expect(await systemDb.session.count()).toBe(0);
  });

  it('logout invalida a sessão no servidor (o cookie antigo não serve mais)', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const owner = await login(harness.app, 'dono@clinica.com');
    expect((await owner.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await owner.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('login descarta a sessão anterior do mesmo navegador (fixação de sessão)', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const first = await login(harness.app, 'dono@clinica.com');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test', cookie: first.cookie },
      payload: { email: 'dono@clinica.com', password: 'senha-de-teste-123' },
    });
    expect(response.statusCode).toBe(200);
    expect((await first.get('/api/auth/me')).statusCode).toBe(401);
    expect(await systemDb.session.count()).toBe(1);
  });
});

describe('autorização', () => {
  it('usuário de empresa (mesmo dono) recebe 403 em toda rota da plataforma', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const owner = await login(harness.app, 'dono@clinica.com');
    const failures: string[] = [];
    for (const route of routes.filter((item) => item.url.startsWith('/api/platform/'))) {
      const response = await request(route, owner.cookie);
      if (response.statusCode !== 403) failures.push(`${key(route)} → ${response.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('papel de leitura recebe 403 em toda escrita para a qual não tem permissão', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@clinica.com',
    });
    await addMember(company.id, 'leitura@clinica.com', 'VIEWER');
    const viewer = await login(harness.app, 'leitura@clinica.com');
    const allowed = new Set<string>(permissionsForRole('VIEWER'));

    const failures: string[] = [];
    for (const route of routes.filter((item) => item.url.startsWith('/api/app/'))) {
      const permission = route.guards.find((g) => g.kind === 'company')?.permission;
      if (!permission || allowed.has(permission)) continue;
      const response = await request(route, viewer.cookie);
      if (response.statusCode !== 403) failures.push(`${key(route)} → ${response.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('não é possível trocar para uma empresa da qual não se é membro', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const other = await createCompanyFixture(harness, { name: 'Outra', ownerEmail: 'b@outra.com' });
    const owner = await login(harness.app, 'dono@clinica.com');
    const response = await owner.post('/api/auth/switch-company', { companyId: other.id });
    expect(response.statusCode).toBe(403);
  });
});

describe('entrada e respostas', () => {
  it('requisição gigante é rejeitada com 413 antes de chegar à rota', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test', 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@a.com', password: 'x'.repeat(3 * 1024 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
  });

  it('payload inválido responde 400 com detalhes, sem stack trace', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test', 'content-type': 'application/json' },
      payload: '{"email": "não-é-email", "password": 123',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
  });

  it('campos extras (mass assignment) são ignorados: não troca empresa nem campos internos', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@clinica.com',
    });
    const other = await createCompanyFixture(harness, { name: 'Outra', ownerEmail: 'b@outra.com' });
    const owner = await login(harness.app, 'dono@clinica.com');
    const created = await owner.post('/api/app/contacts', { phone: '5511912345678', name: 'Ana' });
    expect(created.statusCode).toBe(201);

    const patched = await owner.patch(`/api/app/contacts/${created.json().id}`, {
      name: 'Ana Maria',
      companyId: other.id,
      id: randomUUID(),
      createdAt: '2000-01-01T00:00:00Z',
    });
    expect(patched.statusCode).toBe(200);
    const stored = await systemDb.contact.findUniqueOrThrow({ where: { id: created.json().id } });
    expect(stored).toMatchObject({ companyId: company.id, name: 'Ana Maria' });
    expect(stored.createdAt.getFullYear()).not.toBe(2000);

    const selfPromotion = await owner.patch('/api/app/company', { status: 'ACTIVE', slug: 'hack' });
    expect([200, 400]).toContain(selfPromotion.statusCode);
    expect((await systemDb.company.findUniqueOrThrow({ where: { id: company.id } })).slug).not.toBe(
      'hack',
    );
  });

  it('SQL injection na busca não vaza dados nem quebra a consulta', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@clinica.com' });
    const other = await createCompanyFixture(harness, { name: 'Outra', ownerEmail: 'b@outra.com' });
    await systemDb.contact.create({
      data: { companyId: other.id, phone: '5511900001111', name: 'Segredo Alheio' },
    });
    const owner = await login(harness.app, 'dono@clinica.com');
    for (const q of ["' OR '1'='1", '\'; DROP TABLE "Contact"; --', 'Segredo%', '%']) {
      const response = await owner.get(`/api/app/search?q=${encodeURIComponent(q)}`);
      expect(response.statusCode).toBeLessThan(500);
      expect(response.body).not.toContain('Segredo Alheio');
    }
    expect(await systemDb.contact.count({ where: { name: 'Segredo Alheio' } })).toBe(1);
    const knowledge = await owner.get(
      `/api/app/knowledge/search?q=${encodeURIComponent("x' OR 1=1 --")}`,
    );
    expect(knowledge.statusCode).toBeLessThan(500);
  });

  it('segredos nunca aparecem nas respostas da API', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@clinica.com',
    });
    const owner = await login(harness.app, 'dono@clinica.com');
    const token = `EAAG${'k'.repeat(60)}`;
    const account = await owner.post('/api/app/integrations/whatsapp/accounts', {
      phoneNumberId: '1234567890',
      wabaId: '9876543210',
      accessToken: token,
    });
    expect(account.statusCode).toBeLessThan(300);
    await createUser({ email: 'admin@webzen.com', platformRole: 'PLATFORM_ADMIN' });
    const admin = await login(harness.app, 'admin@webzen.com');

    const bodies = [
      account.body,
      (await owner.get('/api/app/integrations')).body,
      (await owner.get('/api/auth/me')).body,
      (await owner.get('/api/app/team')).body,
      (await owner.get('/api/app/ai')).body,
      (await admin.get(`/api/platform/companies/${company.id}`)).body,
      (await admin.get('/api/platform/health')).body,
    ].join('\n');
    expect(bodies).not.toContain(token);
    expect(bodies).not.toMatch(/passwordHash|tokenHash|accessTokenEncrypted|credentialsEncrypted/);
    expect(bodies).not.toContain(harness.container.env.ENCRYPTION_KEY ?? '__sem_chave__');
    expect(bodies).not.toContain(harness.container.env.WHATSAPP_APP_SECRET ?? '__sem_segredo__');
    expect(bodies).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('respostas trazem cabeçalhos de segurança e não revelam a tecnologia', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('OAuth', () => {
  it('callback com state forjado não conecta nada e só redireciona para o próprio painel', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@clinica.com',
    });
    for (const state of [
      'forjado',
      `${Buffer.from(`${company.id}:x:9999999999999`).toString('base64url')}.assinatura-falsa`,
    ]) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        `${harness.container.env.APP_URL}/app/integrations?google=error`,
      );
    }
    expect(await systemDb.integration.count({ where: { provider: 'GOOGLE_CALENDAR' } })).toBe(0);
  });
});

describe('arquivos', () => {
  it('armazenamento local recusa path traversal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'botsaas-storage-'));
    try {
      const storage = new LocalObjectStorage(root);
      for (const evil of ['../../etc/passwd', '../fora.txt', '/etc/passwd', 'a/../../fora']) {
        await expect(storage.get(evil)).rejects.toThrow(/fora do diretório/);
        await expect(storage.put(evil, Buffer.from('x'))).rejects.toThrow(/fora do diretório/);
      }
      await storage.put('empresa/arquivo.txt', Buffer.from('ok'));
      expect((await storage.get('empresa/arquivo.txt')).toString()).toBe('ok');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
