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

describe('painel da empresa', () => {
  it('testar agente: responde com debug, simula ações e não envia nada ao WhatsApp', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
    });
    await systemDb.service.create({
      data: { companyId: company.id, name: 'Botox', priceCents: 90000 },
    });
    const owner = await login(harness.app, 'dono@c.com');

    harness.ai.enqueue(
      {
        toolCalls: [
          { name: 'search_services', input: { query: 'botox' } },
          { name: 'save_contact_memory', input: { key: 'service_interest', value: 'botox' } },
        ],
      },
      { text: 'O botox custa R$ 900,00.' },
    );
    const response = await owner.post('/api/app/ai/test', { message: 'quanto custa botox?' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.reply).toBe('O botox custa R$ 900,00.');
    expect(body.debug.toolCalls.map((call: { name: string }) => call.name)).toEqual([
      'search_services',
      'save_contact_memory',
    ]);
    expect(body.debug.toolCalls[1].result).toEqual({ simulated: true });
    expect(body.debug.usage.inputTokens).toBeGreaterThan(0);
    expect(body.debug).toHaveProperty('estimatedCostUsd');
    expect(harness.messaging.sent).toHaveLength(0);
    expect(harness.queue.jobs.filter((job) => job.name === 'message.send')).toHaveLength(0);
    expect(await systemDb.contactMemory.count()).toBe(0);
    // Conversas de teste não aparecem na caixa de entrada.
    expect((await owner.get('/api/app/conversations')).json().total).toBe(0);
    expect((await owner.get('/api/app/ai/test')).json().messages).toHaveLength(2);
  });

  it('preview do prompt mostra as camadas para quem tem permissão', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
    });
    await addMember(company.id, 'atendente@c.com', 'ATTENDANT');
    const owner = await login(harness.app, 'dono@c.com');
    await owner.patch('/api/app/ai/config', {
      customRules: ['Não fornecer orçamento de procedimento X sem avaliação.'],
    });
    const preview = (await owner.get('/api/app/ai/prompt-preview')).json();
    expect(preview.sections.map((section: { key: string }) => section.key)).toEqual([
      'base',
      'segment',
      'company',
      'rules',
      'tone',
      'policies',
      'context',
    ]);
    expect(preview.version).toBe(2);
    expect(await systemDb.auditLog.count({ where: { action: 'ai.prompt_changed' } })).toBe(1);

    const attendant = await login(harness.app, 'atendente@c.com');
    expect((await attendant.get('/api/app/ai/prompt-preview')).statusCode).toBe(403);
  });

  it('equipe: convida, respeita hierarquia de papéis e limite de usuários', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
      planKey: 'STARTER',
    });
    const owner = await login(harness.app, 'dono@c.com');
    const invited = await owner.post('/api/app/team', {
      email: 'gerente@c.com',
      name: 'Gerente',
      role: 'COMPANY_ADMIN',
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json().temporaryPassword).toEqual(expect.any(String));

    const admin = await login(harness.app, 'gerente@c.com', invited.json().temporaryPassword);
    expect(
      (
        await admin.post('/api/auth/change-password', {
          currentPassword: invited.json().temporaryPassword,
          newPassword: 'senha-definitiva-gerente-123',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await admin.post('/api/app/team', {
          email: 'outro-dono@c.com',
          name: 'Xavier',
          role: 'COMPANY_OWNER',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await admin.post('/api/app/team', {
          email: 'at@c.com',
          name: 'Atendente',
          role: 'ATTENDANT',
        })
      ).statusCode,
    ).toBe(201);
    // STARTER permite 3 usuários.
    const overLimit = await owner.post('/api/app/team', {
      email: 'quarto@c.com',
      name: 'Quarto',
      role: 'VIEWER',
    });
    expect(overLimit.statusCode).toBe(402);
    expect(
      await systemDb.auditLog.count({ where: { companyId: company.id, action: 'member.invited' } }),
    ).toBe(2);

    const members = (await owner.get('/api/app/team')).json();
    const ownerMember = members.find((member: { role: string }) => member.role === 'COMPANY_OWNER');
    expect(
      (await owner.patch(`/api/app/team/${ownerMember.id}`, { role: 'VIEWER' })).statusCode,
    ).toBe(400);
  });

  it('onboarding salva progresso e ativa a empresa', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@c.com' });
    await systemDb.company.updateMany({ data: { status: 'ONBOARDING' } });
    const owner = await login(harness.app, 'dono@c.com');

    let onboarding = (await owner.get('/api/app/company/onboarding')).json();
    expect(onboarding.steps).toHaveLength(9);
    expect(onboarding.progress).toBe(0);

    await owner.patch('/api/app/company', {
      phone: '(11) 4000-0000',
      description: 'Clínica de estética',
    });
    await owner.put('/api/app/company/business-hours', {
      schedule: [{ weekday: 1, open: '09:00', close: '18:00', breaks: [] }],
    });
    onboarding = (
      await owner.put('/api/app/company/onboarding', { step: 'whatsapp', action: 'skip' })
    ).json();
    expect(onboarding.steps.find((step: { key: string }) => step.key === 'company').done).toBe(
      true,
    );
    expect(onboarding.steps.find((step: { key: string }) => step.key === 'hours').done).toBe(true);
    expect(onboarding.steps.find((step: { key: string }) => step.key === 'whatsapp').skipped).toBe(
      true,
    );

    const blocked = await owner.post('/api/app/company/activate', { enableAi: true });
    expect(blocked.statusCode).toBe(400);
    await owner.patch('/api/app/ai/config', { personality: 'Acolhedora e objetiva' });
    const activated = await owner.post('/api/app/company/activate', { enableAi: true });
    expect(activated.statusCode).toBe(200);
    expect((await owner.get('/api/app/company')).json().status).toBe('ACTIVE');
    expect((await owner.get('/api/app/ai')).json().config.enabled).toBe(true);
  });

  it('CRM: move lead no kanban e registra evento', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
    });
    const owner = await login(harness.app, 'dono@c.com');
    const contact = (
      await owner.post('/api/app/contacts', { name: 'Pedro', phone: '11933332222' })
    ).json();
    const stages = (await owner.get('/api/app/crm/stages')).json();
    const lead = (
      await owner.post('/api/app/crm/leads', { contactId: contact.id, title: 'Pacote facial' })
    ).json();
    expect(lead.stage.key).toBe('NOVO');
    const qualified = stages.find((stage: { key: string }) => stage.key === 'QUALIFICADO');
    const moved = await owner.post(`/api/app/crm/leads/${lead.id}/move`, { stageId: qualified.id });
    expect(moved.json().stage.key).toBe('QUALIFICADO');
    expect(
      await systemDb.domainEvent.count({
        where: { companyId: company.id, type: 'lead.stage_changed' },
      }),
    ).toBe(1);

    const bad = await owner.patch(`/api/app/crm/leads/${lead.id}`, {
      qualification: { campo_inexistente: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await owner.patch(`/api/app/crm/leads/${lead.id}`, {
      qualification: { tipo_consulta: 'primeira consulta' },
    });
    expect(ok.json().qualification).toEqual({ tipo_consulta: 'Primeira consulta' });
  });

  it('automação: novo contato recebe etiqueta', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
      planKey: 'PRO',
    });
    const owner = await login(harness.app, 'dono@c.com');
    const created = await owner.post('/api/app/automations', {
      name: 'Etiquetar novos contatos',
      trigger: 'contact.created',
      actions: [{ type: 'add_tag', tagName: 'NOVO_CONTATO' }],
    });
    expect(created.statusCode).toBe(201);
    await owner.post('/api/app/contacts', { name: 'Lia', phone: '11922221111' });
    const { drainJobs } = await import('./helpers/jobs');
    await drainJobs(harness, { only: ['domain-event.dispatch'] });
    await drainJobs(harness, { only: ['domain-event.dispatch'] });
    const tags = await systemDb.contactTag.findMany({
      where: { companyId: company.id },
      include: { tag: true },
    });
    expect(tags.map((item) => item.tag.name)).toEqual(['NOVO_CONTATO']);
    expect(await systemDb.automationRun.count({ where: { status: 'SUCCEEDED' } })).toBe(1);
  });

  it('LGPD: exporta e exclui dados do contato', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
    });
    const owner = await login(harness.app, 'dono@c.com');
    const contact = (
      await owner.post('/api/app/contacts', { name: 'Ana', phone: '11911110000' })
    ).json();
    await owner.post(`/api/app/contacts/${contact.id}/notes`, {
      body: 'Prefere horários pela manhã',
    });
    const exported = await owner.get(`/api/app/contacts/${contact.id}/export`);
    expect(exported.json().contact.notes[0].body).toBe('Prefere horários pela manhã');
    const csv = await owner.get('/api/app/exports/contacts.csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Ana');

    expect((await owner.delete(`/api/app/contacts/${contact.id}`)).statusCode).toBe(200);
    expect(await systemDb.contact.count({ where: { companyId: company.id } })).toBe(0);
    expect(await systemDb.contactNote.count()).toBe(0);
    expect(
      await systemDb.auditLog.count({
        where: {
          action: { in: ['contact.exported', 'contact.deleted', 'data.contacts_exported'] },
        },
      }),
    ).toBe(3);
  });

  it('memória do contato recusa dados sensíveis', async () => {
    await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'dono@c.com' });
    const owner = await login(harness.app, 'dono@c.com');
    const contact = (
      await owner.post('/api/app/contacts', { name: 'Ana', phone: '11911110000' })
    ).json();
    expect(
      (
        await owner.put(`/api/app/contacts/${contact.id}/memories`, {
          key: 'preferences',
          value: 'Prefere manhã',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await owner.put(`/api/app/contacts/${contact.id}/memories`, {
          key: 'observation',
          value: 'CPF 123.456.789-09',
        })
      ).statusCode,
    ).toBe(400);
  });
});
