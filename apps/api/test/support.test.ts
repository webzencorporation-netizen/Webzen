import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createCompanyFixture,
  createTestHarness,
  createUser,
  login,
  type TestHarness,
} from './helpers/harness';
import { drainJobs } from './helpers/jobs';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

const ticket = {
  subject: 'WhatsApp não conecta',
  category: 'WHATSAPP',
  body: 'Aparece erro ao conectar o número.',
};

async function staff() {
  await createUser({
    email: 'suporte@webzen.test',
    name: 'Ana Suporte',
    platformRole: 'PLATFORM_ADMIN',
  });
  return login(harness.app, 'suporte@webzen.test');
}

describe('chamados de suporte', () => {
  it('plano com suporte prioritário entra na frente da fila', async () => {
    await createCompanyFixture(harness, {
      name: 'Starter',
      ownerEmail: 'a@starter.test',
      planKey: 'STARTER',
    });
    await createCompanyFixture(harness, {
      name: 'Business',
      ownerEmail: 'a@business.test',
      planKey: 'BUSINESS',
    });
    const starter = await login(harness.app, 'a@starter.test');
    const business = await login(harness.app, 'a@business.test');
    const normal = await starter.post('/api/app/support/tickets', ticket);
    const priority = await business.post('/api/app/support/tickets', ticket);
    expect(normal.statusCode).toBe(201);
    expect(normal.json()).toMatchObject({
      priority: 'MEDIUM',
      prioritySupport: false,
      status: 'OPEN',
    });
    expect(priority.json()).toMatchObject({ priority: 'HIGH', prioritySupport: true });

    const queue = (await (await staff()).get('/api/platform/support/tickets')).json<{
      items: { id: string }[];
    }>();
    expect(queue.items.map((item) => item.id)).toEqual([priority.json().id, normal.json().id]);
    expect(
      await systemDb.notification.count({
        where: { companyId: null, title: { startsWith: 'Novo chamado' } },
      }),
    ).toBe(2);
  });

  it('resposta da equipe avisa o cliente; nota interna nunca aparece para ele', async () => {
    await createCompanyFixture(harness, { name: 'Pet', ownerEmail: 'dono@pet.test' });
    const owner = await login(harness.app, 'dono@pet.test');
    const created = (await owner.post('/api/app/support/tickets', ticket)).json<{
      id: string;
      number: number;
    }>();
    const agent = await staff();

    await agent.post(`/api/platform/support/tickets/${created.id}/messages`, {
      body: 'Cliente já tentou duas vezes.',
      internal: true,
    });
    await agent.post(`/api/platform/support/tickets/${created.id}/messages`, {
      body: 'Pode reenviar o código de verificação?',
    });
    await drainJobs(harness, { only: ['email.send'] });

    const view = (await owner.get(`/api/app/support/tickets/${created.id}`)).json<{
      status: string;
      messages: { body: string; authorName: string }[];
    }>();
    expect(view.status).toBe('WAITING_USER');
    expect(view.messages.map((message) => message.body)).toEqual([
      ticket.body,
      'Pode reenviar o código de verificação?',
    ]);
    expect(JSON.stringify(view)).not.toContain('duas vezes');
    expect(view.messages[1]?.authorName).toBe('Equipe WebZen');
    expect(harness.email.sent.at(-1)?.subject).toBe(
      `Resposta no chamado #${created.number} — WebZen`,
    );

    const replied = (
      await owner.post(`/api/app/support/tickets/${created.id}/messages`, {
        body: 'Reenviei agora.',
      })
    ).json();
    expect(replied.status).toBe('OPEN');
  });

  it('isolamento entre empresas e permissões', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Bar',
      ownerEmail: 'dono@bar.test',
    });
    await createCompanyFixture(harness, { name: 'Café', ownerEmail: 'dono@cafe.test' });
    await addMember(company.id, 'atendente@bar.test', 'ATTENDANT');
    const owner = await login(harness.app, 'dono@bar.test');
    const other = await login(harness.app, 'dono@cafe.test');
    const attendant = await login(harness.app, 'atendente@bar.test');

    const created = (await owner.post('/api/app/support/tickets', ticket)).json<{ id: string }>();
    expect((await other.get(`/api/app/support/tickets/${created.id}`)).statusCode).toBe(404);
    expect((await attendant.post('/api/app/support/tickets', ticket)).statusCode).toBe(403);
    expect((await owner.get('/api/platform/support/tickets')).statusCode).toBe(403);

    const feedback = await attendant.post('/api/app/support/feedback', {
      category: 'SUGGESTION',
      message: 'Seria ótimo ter atalhos de teclado.',
      page: '/app/conversations?token=segredo',
    });
    expect(feedback.statusCode).toBe(201);
    const row = await systemDb.feedback.findFirstOrThrow();
    expect(row.page).toBe('/app/conversations');
  });

  it('cliente reabre chamado resolvido por até 7 dias', async () => {
    await createCompanyFixture(harness, { name: 'Ótica', ownerEmail: 'dono@otica.test' });
    const owner = await login(harness.app, 'dono@otica.test');
    const created = (await owner.post('/api/app/support/tickets', ticket)).json<{ id: string }>();
    const agent = await staff();
    await agent.patch(`/api/platform/support/tickets/${created.id}`, { status: 'RESOLVED' });
    expect((await owner.post(`/api/app/support/tickets/${created.id}/reopen`)).json().status).toBe(
      'OPEN',
    );

    await agent.patch(`/api/platform/support/tickets/${created.id}`, { status: 'RESOLVED' });
    await systemDb.supportTicket.update({
      where: { id: created.id },
      data: { resolvedAt: new Date(Date.now() - 8 * 24 * 3600_000) },
    });
    expect((await owner.post(`/api/app/support/tickets/${created.id}/reopen`)).statusCode).toBe(
      400,
    );
  });
});
