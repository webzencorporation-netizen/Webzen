import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';
import { countJobs, drainJobs } from './helpers/jobs';
import {
  buildStatusWebhook,
  createWhatsAppAccount,
  inboundText,
  postWebhook,
} from './helpers/whatsapp';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());

describe('webhook do WhatsApp', () => {
  it('responde à verificação da Meta somente com o token correto', async () => {
    const ok = await harness.app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=abc123',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('abc123');
    const bad = await harness.app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc',
    });
    expect(bad.statusCode).toBe(403);
  });

  it('rejeita assinatura inválida sem persistir nada', async () => {
    const company = await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'a@a.com' });
    await createWhatsAppAccount(company.id, '111');
    const response = await postWebhook(
      harness,
      inboundText('111', '5511999990000', 'oi'),
      'sha256=' + '0'.repeat(64),
    );
    expect(response.statusCode).toBe(401);
    expect(await systemDb.webhookEvent.count()).toBe(0);
  });

  it('recebe mensagem: persiste evento, responde rápido e processa assincronamente', async () => {
    const company = await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'a@a.com' });
    await createWhatsAppAccount(company.id, '111');

    const response = await postWebhook(
      harness,
      inboundText('111', '5511999990000', 'Olá, bom dia', 'wamid.A1'),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().outcomes).toEqual({ queued: 1 });
    // Nada processado ainda: apenas o evento persistido e o job enfileirado.
    expect(await systemDb.message.count()).toBe(0);
    expect(countJobs(harness, 'webhook.process')).toBe(1);

    await drainJobs(harness, { only: ['webhook.process', 'domain-event.dispatch'] });

    const contact = await systemDb.contact.findFirstOrThrow({ where: { companyId: company.id } });
    expect(contact).toMatchObject({
      phone: '5511999990000',
      name: 'João Cliente',
      source: 'whatsapp',
    });
    const conversation = await systemDb.conversation.findFirstOrThrow({
      where: { companyId: company.id },
    });
    expect(conversation).toMatchObject({
      mode: 'AI',
      status: 'OPEN',
      unreadCount: 1,
      lastMessagePreview: 'Olá, bom dia',
    });
    expect(conversation.lastInboundAt).not.toBeNull();
    const message = await systemDb.message.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(message).toMatchObject({
      direction: 'INBOUND',
      sender: 'CONTACT',
      text: 'Olá, bom dia',
      externalId: 'wamid.A1',
    });
    const lead = await systemDb.lead.findFirst({
      where: { contactId: contact.id },
      include: { stage: true },
    });
    expect(lead?.stage.key).toBe('NOVO');
    expect((await systemDb.webhookEvent.findFirstOrThrow()).status).toBe('PROCESSED');
    const notification = await systemDb.notification.findFirst({
      where: { companyId: company.id, type: 'NEW_LEAD' },
    });
    expect(notification).not.toBeNull();
  });

  it('deduplica: a mesma mensagem entregue duas vezes é processada uma única vez', async () => {
    const company = await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'a@a.com' });
    await createWhatsAppAccount(company.id, '111');
    const payload = inboundText('111', '5511999990000', 'oi', 'wamid.DUP');

    const first = await postWebhook(harness, payload);
    const second = await postWebhook(harness, payload);
    expect(first.json().outcomes).toEqual({ queued: 1 });
    expect(second.json().outcomes).toEqual({ duplicate: 1 });
    expect(await systemDb.webhookEvent.count()).toBe(1);

    await drainJobs(harness, { only: ['webhook.process'] });
    // Mesmo que o job rode de novo (retry), a mensagem não duplica.
    const event = await systemDb.webhookEvent.findFirstOrThrow();
    await systemDb.webhookEvent.update({ where: { id: event.id }, data: { status: 'RECEIVED' } });
    harness.queue.jobs.push({
      name: 'webhook.process',
      payload: { webhookEventId: event.id },
      options: {},
    });
    await drainJobs(harness, { only: ['webhook.process'] });
    expect(await systemDb.message.count({ where: { externalId: 'wamid.DUP' } })).toBe(1);
  });

  it('identifica a empresa pelo número: eventos de números desconhecidos são ignorados', async () => {
    const response = await postWebhook(harness, inboundText('999', '5511999990000', 'oi'));
    expect(response.json().outcomes).toEqual({ unknown_number: 1 });
    expect((await systemDb.webhookEvent.findFirstOrThrow()).status).toBe('IGNORED');
    expect(await systemDb.message.count()).toBe(0);
  });

  it('mensagem só com BSUID (sem telefone) fica retida e visível, sem ser dada como processada', async () => {
    const company = await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'a@a.com' });
    await createWhatsAppAccount(company.id, '111');
    const payload = inboundText('111', '5511999990000', 'quero agendar', 'wamid.bsuid-1');
    const value = payload.entry[0]!.changes[0]!.value;
    value.contacts = [
      { profile: { name: 'Bia', username: 'bia' }, user_id: 'BR.9999' },
    ] as unknown as typeof value.contacts;
    const { from: _omitted, ...withoutPhone } = value.messages[0]!;
    value.messages = [{ ...withoutPhone, from_user_id: 'BR.9999' }] as unknown as typeof value.messages;

    for (let delivery = 0; delivery < 2; delivery += 1) {
      const response = await postWebhook(harness, payload);
      expect(response.statusCode).toBe(200);
    }

    const stored = await systemDb.webhookEvent.findFirstOrThrow();
    expect(stored).toMatchObject({
      eventType: 'message_without_phone',
      status: 'IGNORED',
      companyId: company.id,
      dedupeKey: 'wamid.bsuid-1',
    });
    expect(JSON.stringify(stored.payload)).toContain('quero agendar');
    expect(countJobs(harness, 'webhook.process')).toBe(0);
    expect(await systemDb.contact.count()).toBe(0);
    const errors = await systemDb.errorLog.findMany({ where: { companyId: company.id } });
    expect(errors).toEqual([
      expect.objectContaining({ source: 'WEBHOOK', code: 'whatsapp_message_without_phone' }),
    ]);
    expect(errors[0]?.message).not.toContain('quero agendar');
  });

  it('atualiza status enviado → entregue → lido sem regredir e registra falhas', async () => {
    const company = await createCompanyFixture(harness, { name: 'Clínica', ownerEmail: 'a@a.com' });
    await createWhatsAppAccount(company.id, '111');
    await postWebhook(harness, inboundText('111', '5511999990000', 'oi'));
    await drainJobs(harness, { only: ['webhook.process'] });
    const conversation = await systemDb.conversation.findFirstOrThrow();
    const outbound = await systemDb.message.create({
      data: {
        companyId: company.id,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        sender: 'AI',
        text: 'Olá!',
        status: 'SENT',
        externalId: 'wamid.OUT1',
      },
    });

    for (const status of ['read', 'delivered'] as const) {
      await postWebhook(
        harness,
        buildStatusWebhook({
          phoneNumberId: '111',
          messageId: 'wamid.OUT1',
          status,
          recipientId: '5511999990000',
        }),
      );
    }
    await drainJobs(harness, { only: ['webhook.process'] });
    const afterRead = await systemDb.message.findUniqueOrThrow({ where: { id: outbound.id } });
    expect(afterRead.status).toBe('READ');
    expect(afterRead.readAt).not.toBeNull();

    await systemDb.message.update({
      where: { id: outbound.id },
      data: { status: 'SENT', externalId: 'wamid.OUT2' },
    });
    await postWebhook(
      harness,
      buildStatusWebhook({
        phoneNumberId: '111',
        messageId: 'wamid.OUT2',
        status: 'failed',
        recipientId: '55',
        errorCode: 131047,
      }),
    );
    await drainJobs(harness, { only: ['webhook.process'] });
    const failed = await systemDb.message.findUniqueOrThrow({ where: { id: outbound.id } });
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: '131047' });
    expect(failed.errorMessage).toMatch(/24h/);
    expect(
      (await systemDb.conversation.findUniqueOrThrow({ where: { id: conversation.id } }))
        .needsAttention,
    ).toBe(true);
  });
});
