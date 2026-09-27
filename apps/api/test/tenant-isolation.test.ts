import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createCompanyFixture,
  createTestHarness,
  login,
  type TestHarness,
} from './helpers/harness';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());

describe('isolamento entre empresas (multi-tenant)', () => {
  it('Empresa B não consegue ler, alterar ou excluir o contato João da Empresa A', async () => {
    await createCompanyFixture(harness, { name: 'Empresa A', ownerEmail: 'a@a.com' });
    await createCompanyFixture(harness, { name: 'Empresa B', ownerEmail: 'b@b.com' });
    const clientA = await login(harness.app, 'a@a.com');
    const clientB = await login(harness.app, 'b@b.com');

    const created = await clientA.post('/api/app/contacts', {
      name: 'João',
      phone: '11 98888-7777',
    });
    expect(created.statusCode).toBe(201);
    const joaoId = created.json().id as string;

    const read = await clientB.get(`/api/app/contacts/${joaoId}`);
    expect([403, 404]).toContain(read.statusCode);
    expect(read.body).not.toContain('João');

    const update = await clientB.patch(`/api/app/contacts/${joaoId}`, { name: 'Hackeado' });
    expect([403, 404]).toContain(update.statusCode);
    const remove = await clientB.delete(`/api/app/contacts/${joaoId}`);
    expect([403, 404]).toContain(remove.statusCode);
    const exported = await clientB.get(`/api/app/contacts/${joaoId}/export`);
    expect([403, 404]).toContain(exported.statusCode);
    const note = await clientB.post(`/api/app/contacts/${joaoId}/notes`, { body: 'x' });
    expect([403, 404]).toContain(note.statusCode);

    const list = await clientB.get('/api/app/contacts');
    expect(list.json().total).toBe(0);

    const stillThere = await systemDb.contact.findUniqueOrThrow({ where: { id: joaoId } });
    expect(stillThere.name).toBe('João');
  });

  it('ignora companyId enviado pelo cliente', async () => {
    const companyA = await createCompanyFixture(harness, {
      name: 'Empresa A',
      ownerEmail: 'a@a.com',
    });
    await createCompanyFixture(harness, { name: 'Empresa B', ownerEmail: 'b@b.com' });
    const clientB = await login(harness.app, 'b@b.com');
    const response = await clientB.post('/api/app/contacts', {
      phone: '11977776666',
      companyId: companyA.id,
    });
    expect(response.statusCode).toBe(201);
    const contact = await systemDb.contact.findUniqueOrThrow({ where: { id: response.json().id } });
    expect(contact.companyId).not.toBe(companyA.id);
  });

  it('não permite trocar para uma empresa da qual o usuário não é membro', async () => {
    const companyA = await createCompanyFixture(harness, {
      name: 'Empresa A',
      ownerEmail: 'a@a.com',
    });
    await createCompanyFixture(harness, { name: 'Empresa B', ownerEmail: 'b@b.com' });
    const clientB = await login(harness.app, 'b@b.com');
    const response = await clientB.post('/api/auth/switch-company', { companyId: companyA.id });
    expect(response.statusCode).toBe(403);
  });

  it('usuário em duas empresas só enxerga a empresa ativa', async () => {
    const companyA = await createCompanyFixture(harness, {
      name: 'Empresa A',
      ownerEmail: 'a@a.com',
    });
    const companyB = await createCompanyFixture(harness, {
      name: 'Empresa B',
      ownerEmail: 'b@b.com',
    });
    await addMember(companyB.id, 'a@a.com', 'MANAGER');
    const client = await login(harness.app, 'a@a.com');

    await client.post('/api/app/contacts', { name: 'Cliente da A', phone: '11911112222' });
    const switched = await client.post('/api/auth/switch-company', { companyId: companyB.id });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().activeCompany.id).toBe(companyB.id);
    expect((await client.get('/api/app/contacts')).json().total).toBe(0);

    await client.post('/api/auth/switch-company', { companyId: companyA.id });
    expect((await client.get('/api/app/contacts')).json().total).toBe(1);
  });

  it('membro desativado perde o acesso imediatamente', async () => {
    const companyA = await createCompanyFixture(harness, {
      name: 'Empresa A',
      ownerEmail: 'a@a.com',
    });
    const user = await addMember(companyA.id, 'atendente@a.com', 'ATTENDANT');
    const client = await login(harness.app, 'atendente@a.com');
    expect((await client.get('/api/app/contacts')).statusCode).toBe(200);
    await systemDb.companyMember.update({
      where: { companyId_userId: { companyId: companyA.id, userId: user.id } },
      data: { isActive: false },
    });
    expect((await client.get('/api/app/contacts')).statusCode).toBe(403);
  });
});
