import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
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

describe('RBAC', () => {
  it('VIEWER lê mas não cria contatos; ATTENDANT cria mas não exclui', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Empresa A',
      ownerEmail: 'dono@a.com',
    });
    await addMember(company.id, 'viewer@a.com', 'VIEWER');
    await addMember(company.id, 'attendant@a.com', 'ATTENDANT');

    const viewer = await login(harness.app, 'viewer@a.com');
    expect((await viewer.get('/api/app/contacts')).statusCode).toBe(200);
    expect((await viewer.post('/api/app/contacts', { phone: '11955554444' })).statusCode).toBe(403);

    const attendant = await login(harness.app, 'attendant@a.com');
    const created = await attendant.post('/api/app/contacts', { phone: '11955554444' });
    expect(created.statusCode).toBe(201);
    expect((await attendant.delete(`/api/app/contacts/${created.json().id}`)).statusCode).toBe(403);

    const owner = await login(harness.app, 'dono@a.com');
    expect((await owner.delete(`/api/app/contacts/${created.json().id}`)).statusCode).toBe(200);
  });

  it('usuários de empresa não acessam a área da plataforma', async () => {
    await createCompanyFixture(harness, { name: 'Empresa A', ownerEmail: 'dono@a.com' });
    const owner = await login(harness.app, 'dono@a.com');
    expect((await owner.get('/api/platform/companies')).statusCode).toBe(403);
    expect((await owner.post('/api/platform/companies', {})).statusCode).toBe(403);
  });

  it('PLATFORM_ADMIN não gerencia outros administradores; PLATFORM_OWNER sim', async () => {
    await createUser({ email: 'owner@plataforma.com', platformRole: 'PLATFORM_OWNER' });
    await createUser({ email: 'admin@plataforma.com', platformRole: 'PLATFORM_ADMIN' });
    const admin = await login(harness.app, 'admin@plataforma.com');
    const owner = await login(harness.app, 'owner@plataforma.com');
    expect((await admin.get('/api/platform/companies')).statusCode).toBe(200);
    expect((await admin.get('/api/platform/admins')).statusCode).toBe(403);
    expect((await owner.get('/api/platform/admins')).statusCode).toBe(200);
  });
});
