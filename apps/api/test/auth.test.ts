import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCompanyFixture,
  createTestHarness,
  DEFAULT_PASSWORD,
  login,
  type TestHarness,
} from './helpers/harness';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());

describe('autenticação', () => {
  it('faz login, retorna o usuário com a empresa ativa e define cookie httpOnly', async () => {
    await createCompanyFixture(harness, { name: 'Clínica A', ownerEmail: 'dono@a.com' });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test' },
      payload: { email: 'DONO@a.com', password: DEFAULT_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const body = response.json();
    expect(body.user.email).toBe('dono@a.com');
    expect(body.activeCompany.name).toBe('Clínica A');
    expect(body.activeCompany.role).toBe('COMPANY_OWNER');
    expect(body).not.toHaveProperty('user.passwordHash');
  });

  it('recusa senha errada e usuário inexistente com a mesma mensagem', async () => {
    await createCompanyFixture(harness, { name: 'Clínica A', ownerEmail: 'dono@a.com' });
    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test' },
      payload: { email: 'dono@a.com', password: 'errada-123456' },
    });
    const missing = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test' },
      payload: { email: 'ninguem@a.com', password: 'errada-123456' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(missing.json().error.message);
  });

  it('bloqueia mutações sem header anti-CSRF e origem estrangeira', async () => {
    const noHeader = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@a.com', password: 'x' },
    });
    expect(noHeader.statusCode).toBe(403);
    const foreign = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test', origin: 'https://evil.example' },
      payload: { email: 'a@a.com', password: 'x' },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('exige autenticação nas rotas do painel e encerra sessão no logout', async () => {
    await createCompanyFixture(harness, { name: 'Clínica A', ownerEmail: 'dono@a.com' });
    const anonymous = await harness.app.inject({ method: 'GET', url: '/api/app/contacts' });
    expect(anonymous.statusCode).toBe(401);

    const client = await login(harness.app, 'dono@a.com');
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);
    expect((await client.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('não expõe stack trace em erros', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/rota-que-nao-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toMatch(/at .*\.ts/);
    expect(response.json().error.requestId).toBeTruthy();
  });
});
