import { systemDb } from '@botsaas/database';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAvailableSlots, localDateTimeToUtc } from '../src/modules/calendar/availability';
import {
  createCompanyFixture,
  createTestHarness,
  login,
  type TestHarness,
} from './helpers/harness';
import { drainJobs } from './helpers/jobs';
import { createWhatsAppAccount, inboundText, postWebhook } from './helpers/whatsapp';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());
afterEach(() => vi.useRealTimers());

const WEEKDAYS = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  open: '09:00',
  close: '18:00',
  breaks: [{ start: '12:00', end: '13:00' }],
}));

describe('disponibilidade (pura)', () => {
  it('converte horário local para UTC considerando o fuso da empresa', () => {
    expect(localDateTimeToUtc('2026-10-05', 9 * 60, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-05T12:00:00.000Z',
    );
    expect(localDateTimeToUtc('2026-10-05', 9 * 60, 'Europe/Lisbon').toISOString()).toBe(
      '2026-10-05T08:00:00.000Z',
    );
  });

  it('respeita expediente, pausa, feriado, ocupação e antecedência', () => {
    const slots = computeAvailableSlots({
      fromDate: '2026-10-05',
      days: 2,
      durationMinutes: 60,
      timezone: 'America/Sao_Paulo',
      schedule: WEEKDAYS,
      holidays: [{ date: '2026-10-06', name: 'Feriado local', closed: true }],
      busy: [{ start: new Date('2026-10-05T13:00:00Z'), end: new Date('2026-10-05T14:00:00Z') }],
      now: new Date('2026-10-01T00:00:00Z'),
      stepMinutes: 60,
    });
    const local = slots.map((slot) => slot.start.toISOString());
    expect(local).toEqual([
      '2026-10-05T12:00:00.000Z', // 09:00 local
      // 10:00 ocupado; 12:00–13:00 pausa
      '2026-10-05T14:00:00.000Z',
      '2026-10-05T16:00:00.000Z',
      '2026-10-05T17:00:00.000Z',
      '2026-10-05T18:00:00.000Z',
      '2026-10-05T19:00:00.000Z',
      '2026-10-05T20:00:00.000Z',
    ]);
  });
});

describe('agenda', () => {
  async function setup() {
    const company = await createCompanyFixture(harness, {
      name: 'Clínica',
      ownerEmail: 'dono@c.com',
      planKey: 'PRO',
    });
    await systemDb.company.update({ where: { id: company.id }, data: { businessHours: WEEKDAYS } });
    const service = await systemDb.service.create({
      data: { companyId: company.id, name: 'Consulta', durationMinutes: 60, priceCents: 20000 },
    });
    const contact = await systemDb.contact.create({
      data: { companyId: company.id, phone: '5511977776666', name: 'Maria' },
    });
    return { company, service, contact, owner: await login(harness.app, 'dono@c.com') };
  }

  it('cria agendamento, impede conflito, remarca e cancela', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const { service, contact, owner } = await setup();

    const availability = (
      await owner.get(`/api/app/calendar/availability?date=2026-10-05&serviceId=${service.id}`)
    ).json();
    expect(availability.timezone).toBe('America/Sao_Paulo');
    expect(availability.slots[0].start).toBe('2026-10-05T12:00:00.000Z');

    const created = await owner.post('/api/app/calendar/appointments', {
      contactId: contact.id,
      serviceId: service.id,
      startAt: '2026-10-05T12:00:00.000Z',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'CONFIRMED',
      timezone: 'America/Sao_Paulo',
      endAt: '2026-10-05T13:00:00.000Z',
    });

    const conflict = await owner.post('/api/app/calendar/appointments', {
      contactId: contact.id,
      serviceId: service.id,
      startAt: '2026-10-05T12:30:00.000Z',
    });
    expect(conflict.statusCode).toBe(409);

    const moved = await owner.post(
      `/api/app/calendar/appointments/${created.json().id}/reschedule`,
      { startAt: '2026-10-05T14:00:00.000Z' },
    );
    expect(moved.json().startAt).toBe('2026-10-05T14:00:00.000Z');

    const cancelled = await owner.post(
      `/api/app/calendar/appointments/${created.json().id}/status`,
      { status: 'CANCELLED', reason: 'cliente desistiu' },
    );
    expect(cancelled.json()).toMatchObject({
      status: 'CANCELLED',
      cancelledReason: 'cliente desistiu',
    });
    expect(
      await systemDb.domainEvent.count({
        where: { type: { in: ['appointment.created', 'appointment.cancelled'] } },
      }),
    ).toBe(2);
  });

  it('agenda pelo agente: a tool usa o contato da conversa e exige confirmação explícita', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const { company, service } = await setup();
    await createWhatsAppAccount(company.id, '777');
    await systemDb.aIConfiguration.update({
      where: { companyId: company.id },
      data: { enabled: true, messageBufferSeconds: 0 },
    });

    harness.ai.enqueue(
      // Sem confirmação: o schema rejeita e nada é criado.
      {
        toolCalls: [
          {
            name: 'create_appointment',
            input: { serviceId: service.id, startAt: '2026-10-05T12:00:00.000Z' },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'create_appointment',
            input: {
              serviceId: service.id,
              startAt: '2026-10-05T12:00:00.000Z',
              customerConfirmed: true,
            },
          },
        ],
      },
      { text: 'Pronto! Sua consulta está marcada para segunda às 09:00.' },
    );
    await postWebhook(harness, inboundText('777', '5511955554444', 'sim, pode marcar segunda 9h'));
    await drainJobs(harness, { only: ['webhook.process', 'agent.reply'] });

    const appointments = await systemDb.appointment.findMany({
      where: { companyId: company.id },
      include: { contact: true },
    });
    expect(appointments).toHaveLength(1);
    expect(appointments[0]?.contact.phone).toBe('5511955554444');
    expect(appointments[0]?.createdByType).toBe('AI');
    const run = await systemDb.agentRun.findFirstOrThrow({ where: { companyId: company.id } });
    expect(run.toolCalls).toEqual([
      expect.objectContaining({
        name: 'create_appointment',
        ok: false,
        errorCode: 'invalid_input',
      }),
      expect.objectContaining({ name: 'create_appointment', ok: true }),
    ]);
  });

  it('restaurante (sem agenda no template/plano) não recebe tools de agendamento', async () => {
    const company = await createCompanyFixture(harness, {
      name: 'Restaurante',
      ownerEmail: 'r@r.com',
      templateKey: 'RESTAURANT',
      planKey: 'STARTER',
    });
    await createWhatsAppAccount(company.id, '888');
    await systemDb.aIConfiguration.update({
      where: { companyId: company.id },
      data: { enabled: true, messageBufferSeconds: 0 },
    });
    harness.ai.enqueue({ text: 'Olá!' });
    await postWebhook(harness, inboundText('888', '5511944443333', 'oi'));
    await drainJobs(harness, { only: ['webhook.process', 'agent.reply'] });
    const tools = harness.ai.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(tools).toContain('search_products');
    expect(tools).not.toContain('create_appointment');
    const owner = await login(harness.app, 'r@r.com');
    expect(
      (await owner.get('/api/app/calendar/appointments?from=2026-10-01&to=2026-10-02')).statusCode,
    ).toBe(403);
  });
});
