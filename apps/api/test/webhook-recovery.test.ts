import { systemDb } from '@botsaas/database';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { ingestInboundMessage } from '../src/modules/messaging/inbound';
import { processWebhookEvent } from '../src/modules/webhooks/service';
import type { JobName } from '../src/queues/types';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';
import { countJobs, drainJobs } from './helpers/jobs';
import { createWhatsAppAccount, inboundText, postWebhook } from './helpers/whatsapp';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const company = await createCompanyFixture(harness, {
    name: 'Recuperação',
    ownerEmail: 'owner@recovery.test',
  });
  const account = await createWhatsAppAccount(company.id, 'recovery-number');
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: { enabled: true, messageBufferSeconds: 0 },
  });
  return { company, account, scope: systemScope(harness.container, company.id) };
}

describe('recuperação de entradas após falhas', () => {
  it('reenfileira na reentrega quando o evento foi persistido mas o Redis falhou', async () => {
    await setup();
    const payload = inboundText('recovery-number', '5511999990000', 'oi', 'wamid.retry-enqueue');
    vi.spyOn(harness.queue, 'enqueue').mockRejectedValueOnce(new Error('Redis indisponível'));
    expect((await postWebhook(harness, payload)).statusCode).toBe(500);
    expect(await systemDb.webhookEvent.count()).toBe(1);
    expect(countJobs(harness, 'webhook.process')).toBe(0);

    expect((await postWebhook(harness, payload)).statusCode).toBe(200);
    expect(countJobs(harness, 'webhook.process')).toBe(1);
    await drainJobs(harness, { only: ['webhook.process', 'domain-event.dispatch'] });
    expect(await systemDb.message.count()).toBe(1);
    expect((await systemDb.webhookEvent.findFirstOrThrow()).status).toBe('PROCESSED');
  });

  it('reentrega não reinicia automaticamente um webhook com tentativas esgotadas', async () => {
    await setup();
    const payload = inboundText('recovery-number', '5511999990000', 'oi', 'wamid.exhausted');
    await postWebhook(harness, payload);
    harness.queue.take('webhook.process');
    await systemDb.webhookEvent.updateMany({ data: { status: 'FAILED', attempts: 5 } });
    expect((await postWebhook(harness, payload)).json().outcomes).toEqual({ duplicate: 1 });
    expect(countJobs(harness, 'webhook.process')).toBe(0);
    expect((await systemDb.webhookEvent.findFirstOrThrow()).attempts).toBe(5);
  });

  it.each(['domain-event.dispatch', 'agent.reply', 'media.process'] as const)(
    'retoma efeitos após falha em %s sem duplicar entrada, mídia, consumo ou lead',
    async (failedJob) => {
      const { scope, account } = await setup();
      const input = {
        accountId: account.id,
        contact: { waId: '5511999990000', profileName: 'Cliente' },
        message: {
          externalId: `wamid.effects.${failedJob}`,
          from: '5511999990000',
          type: failedJob === 'media.process' ? ('IMAGE' as const) : ('TEXT' as const),
          text: 'oi',
          timestamp: new Date(),
          ...(failedJob === 'media.process'
            ? { media: { id: 'media-123', mimeType: 'image/jpeg' } }
            : {}),
        },
      };
      const enqueue = harness.queue.enqueue.bind(harness.queue);
      let failed = false;
      vi.spyOn(harness.queue, 'enqueue').mockImplementation(async (name, payload, options) => {
        if (name === failedJob && !failed) {
          failed = true;
          throw new Error('Redis indisponível');
        }
        await enqueue<JobName>(name, payload, options);
      });
      await expect(ingestInboundMessage(scope, input)).rejects.toThrow('Redis indisponível');
      const result = await ingestInboundMessage(scope, input);
      expect(result.messageId).toBeDefined();
      expect(await systemDb.message.count()).toBe(1);
      expect(await systemDb.contact.count()).toBe(1);
      expect(await systemDb.conversation.count()).toBe(1);
      expect((await systemDb.conversation.findFirstOrThrow()).unreadCount).toBe(1);
      expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_RECEIVED' } })).toBe(1);
      expect(await systemDb.lead.count()).toBe(1);
      expect(await systemDb.domainEvent.count({ where: { type: 'message.received' } })).toBe(1);
      expect(await systemDb.mediaAsset.count()).toBe(failedJob === 'media.process' ? 1 : 0);
      expect(countJobs(harness, failedJob)).toBeGreaterThan(0);
      await drainJobs(harness, { only: ['domain-event.dispatch'] });
      expect(await systemDb.notification.count({ where: { type: 'NEW_LEAD' } })).toBe(1);
    },
  );

  it('retry do worker recupera o agendamento após gravar a mensagem', async () => {
    await setup();
    await postWebhook(
      harness,
      inboundText('recovery-number', '5511999990000', 'oi', 'wamid.worker-retry'),
    );
    const event = await systemDb.webhookEvent.findFirstOrThrow();
    const enqueue = harness.queue.enqueue.bind(harness.queue);
    vi.spyOn(harness.queue, 'enqueue').mockImplementation(async (name, payload, options) => {
      if (name === 'agent.reply') throw new Error('Redis indisponível');
      await enqueue<JobName>(name, payload, options);
    });
    await expect(
      processWebhookEvent(harness.container, event.id, { attemptsMade: 0, maxAttempts: 5 }),
    ).rejects.toThrow('Redis indisponível');
    expect(
      (await systemDb.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).status,
    ).toBe('FAILED');
    vi.restoreAllMocks();
    await processWebhookEvent(harness.container, event.id, { attemptsMade: 1, maxAttempts: 5 });
    expect(countJobs(harness, 'agent.reply')).toBe(1);
    expect(await systemDb.message.count()).toBe(1);
    expect(
      (await systemDb.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).status,
    ).toBe('PROCESSED');
  });

  it('entradas concorrentes do mesmo contato preservam uma conversa e efeitos únicos', async () => {
    const { scope, account } = await setup();
    const input = {
      accountId: account.id,
      contact: { waId: '5511999990000' },
      message: {
        externalId: 'wamid.race',
        from: '5511999990000',
        type: 'TEXT' as const,
        text: 'oi',
        timestamp: new Date(),
      },
    };
    await Promise.all([
      ingestInboundMessage(scope, input),
      ingestInboundMessage(scope, input),
      ingestInboundMessage(scope, {
        ...input,
        message: { ...input.message, externalId: 'wamid.race2', text: 'mais uma' },
      }),
    ]);
    expect(await systemDb.contact.count()).toBe(1);
    expect(await systemDb.conversation.count()).toBe(1);
    expect(await systemDb.message.count()).toBe(2);
    expect((await systemDb.conversation.findFirstOrThrow()).unreadCount).toBe(2);
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_RECEIVED' } })).toBe(2);
    expect(await systemDb.lead.count()).toBe(1);
  });

  it('falha de banco reverte também o contato e sua outbox antes de publicar jobs', async () => {
    const { scope, account } = await setup();
    const input = {
      accountId: '00000000-0000-4000-8000-000000000000',
      contact: { waId: '5511999990000' },
      message: {
        externalId: 'wamid.rollback',
        from: '5511999990000',
        type: 'TEXT' as const,
        text: 'oi',
        timestamp: new Date(),
      },
    };
    await expect(ingestInboundMessage(scope, input)).rejects.toThrow();
    expect(await systemDb.contact.count()).toBe(0);
    expect(await systemDb.conversation.count()).toBe(0);
    expect(await systemDb.message.count()).toBe(0);
    expect(await systemDb.domainEvent.count()).toBe(0);
    expect(harness.queue.jobs).toHaveLength(0);
    await ingestInboundMessage(scope, { ...input, accountId: account.id });
    expect(await systemDb.message.count()).toBe(1);
    expect(await systemDb.lead.count()).toBe(1);
  });

  it('não agenda nova resposta quando a entrada repetida já foi tratada pelo agente', async () => {
    const { scope, account } = await setup();
    const input = {
      accountId: account.id,
      contact: { waId: '5511999990000' },
      message: {
        externalId: 'wamid.handled',
        from: '5511999990000',
        type: 'TEXT' as const,
        text: 'oi',
        timestamp: new Date(),
      },
    };
    await ingestInboundMessage(scope, input);
    harness.ai.enqueue({ text: 'Olá!' });
    await drainJobs(harness, { only: ['agent.reply', 'message.send', 'domain-event.dispatch'] });
    const duplicate = await ingestInboundMessage(scope, input);
    expect(duplicate.duplicate).toBe(true);
    expect(countJobs(harness, 'agent.reply')).toBe(0);
    expect(countJobs(harness, 'domain-event.dispatch')).toBe(0);
    expect(harness.ai.requests).toHaveLength(1);
    expect(harness.messaging.sent).toHaveLength(1);
  });
});
