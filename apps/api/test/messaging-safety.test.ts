import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { ingestInboundMessage } from '../src/modules/messaging/inbound';
import { queueOutboundTemplate, queueOutboundText } from '../src/modules/messaging/outbound';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';
import { drainJobs } from './helpers/jobs';
import { createWhatsAppAccount } from './helpers/whatsapp';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());

async function setup(timestamp = new Date()) {
  const company = await createCompanyFixture(harness, {
    name: 'Janela',
    ownerEmail: 'owner@window.test',
  });
  const account = await createWhatsAppAccount(company.id, 'window-number');
  const scope = systemScope(harness.container, company.id);
  const input = {
    accountId: account.id,
    contact: { waId: '5511999990000' },
    message: {
      externalId: 'wamid.window',
      from: '5511999990000',
      type: 'TEXT' as const,
      text: 'mais recente',
      timestamp,
    },
  };
  const result = await ingestInboundMessage(scope, input);
  await systemDb.whatsAppTemplate.create({
    data: {
      companyId: company.id,
      whatsappAccountId: account.id,
      name: 'retomar',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá!' }],
    },
  });
  return { company, account, scope, input, ...result };
}

describe('janela e consentimento no envio', () => {
  it('webhook atrasado conserva timestamp original e não reabre a janela de 24h', async () => {
    const timestamp = new Date(Date.now() - 25 * 3600_000);
    const { scope, conversationId } = await setup(timestamp);
    expect(
      (await systemDb.conversation.findUniqueOrThrow({ where: { id: conversationId } }))
        .lastInboundAt,
    ).toEqual(timestamp);
    await expect(
      queueOutboundText(scope, { conversationId, sender: 'AGENT', text: 'resposta atrasada' }),
    ).rejects.toThrow(/24h/);
  });

  it('entrada fora de ordem não faz timestamp e preview regredirem', async () => {
    const timestamp = new Date(Date.now() - 3600_000);
    const { scope, input, conversationId, contactId } = await setup(timestamp);
    await ingestInboundMessage(scope, {
      ...input,
      message: {
        ...input.message,
        externalId: 'wamid.older',
        text: 'mais antiga',
        timestamp: new Date(timestamp.getTime() - 3600_000),
      },
    });
    const conversation = await systemDb.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation).toMatchObject({
      lastInboundAt: timestamp,
      lastMessageAt: timestamp,
      lastMessagePreview: 'mais recente',
      unreadCount: 2,
    });
    expect(
      (await systemDb.contact.findUniqueOrThrow({ where: { id: contactId } })).lastInteractionAt,
    ).toEqual(timestamp);
  });

  it('timestamp futuro é limitado ao momento da ingestão', async () => {
    const before = Date.now();
    const { conversationId } = await setup(new Date(before + 3600_000));
    const conversation = await systemDb.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation.lastInboundAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(conversation.lastInboundAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('texto enfileirado dentro da janela é bloqueado se ela expirar antes do worker', async () => {
    const { scope, conversationId } = await setup();
    const message = await queueOutboundText(scope, { conversationId, sender: 'AGENT', text: 'oi' });
    await systemDb.conversation.update({
      where: { id: conversationId },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await drainJobs(harness, { only: ['message.send'] });
    const after = await systemDb.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.status).toBe('FAILED');
    expect(after.errorMessage).toMatch(/24h/);
    expect(harness.messaging.sent).toHaveLength(0);
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(0);
    expect(await systemDb.notification.count({ where: { type: 'MESSAGE_FAILED' } })).toBe(1);
  });

  it.each(['text', 'template'] as const)(
    'opt-out posterior ao enqueue bloqueia %s no worker',
    async (kind) => {
      const { scope, conversationId, contactId } = await setup();
      const message =
        kind === 'text'
          ? await queueOutboundText(scope, { conversationId, sender: 'AGENT', text: 'oi' })
          : await queueOutboundTemplate(scope, {
              conversationId,
              sender: 'AGENT',
              templateName: 'retomar',
              languageCode: 'pt_BR',
              bodyParameters: [],
            });
      await systemDb.contact.update({ where: { id: contactId }, data: { optedOut: true } });
      await drainJobs(harness, { only: ['message.send'] });
      const after = await systemDb.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.status).toBe('FAILED');
      expect(after.errorMessage).toMatch(/não receber/);
      expect(harness.messaging.sent).toHaveLength(0);
    },
  );

  it('permite template aprovado fora da janela e texto após nova entrada', async () => {
    const { scope, conversationId, input } = await setup(new Date(Date.now() - 25 * 3600_000));
    await queueOutboundTemplate(scope, {
      conversationId,
      sender: 'AGENT',
      templateName: 'retomar',
      languageCode: 'pt_BR',
      bodyParameters: [],
    });
    await drainJobs(harness, { only: ['message.send'] });
    expect(harness.messaging.sent[0]?.kind).toBe('template');
    await ingestInboundMessage(scope, {
      ...input,
      message: { ...input.message, externalId: 'wamid.new-window', timestamp: new Date() },
    });
    await queueOutboundText(scope, { conversationId, sender: 'AGENT', text: 'oi' });
    await drainJobs(harness, { only: ['message.send'] });
    expect(harness.messaging.sent.map((sent) => sent.kind)).toEqual(['template', 'text']);
  });
});
