import { systemDb } from '@botsaas/database';
import { WhatsAppApiError } from '@botsaas/whatsapp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { ingestInboundMessage } from '../src/modules/messaging/inbound';
import { processMediaAsset } from '../src/modules/messaging/media';
import { processOutboundMessage, queueOutboundText } from '../src/modules/messaging/outbound';
import type { JobName } from '../src/queues/types';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';
import { countJobs, drainJobs } from './helpers/jobs';
import { createWhatsAppAccount } from './helpers/whatsapp';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => harness.reset());
afterEach(() => vi.restoreAllMocks());

async function setup(media = false) {
  const company = await createCompanyFixture(harness, {
    name: 'Efeitos',
    ownerEmail: 'owner@effects.test',
  });
  const account = await createWhatsAppAccount(company.id, 'effects-number');
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: { enabled: true, messageBufferSeconds: 0 },
  });
  const scope = systemScope(harness.container, company.id);
  const result = await ingestInboundMessage(scope, {
    accountId: account.id,
    contact: { waId: '5511999990000' },
    message: {
      externalId: 'wamid.effects',
      from: '5511999990000',
      type: media ? 'IMAGE' : 'TEXT',
      text: 'oi',
      timestamp: new Date(),
      ...(media ? { media: { id: 'image-123', mimeType: 'image/jpeg' } } : {}),
    },
  });
  harness.queue.clear();
  return { scope, ...result };
}

describe('efeitos depois de chamadas externas concluídas', () => {
  it('recupera aceite gravado antes de consumo/outbox, inclusive com retries concorrentes', async () => {
    const { scope, conversationId } = await setup();
    const message = await queueOutboundText(scope, {
      conversationId,
      sender: 'AGENT',
      text: 'Olá!',
    });
    await systemDb.message.update({
      where: { id: message.id },
      data: {
        status: 'DELIVERED',
        externalId: 'wamid.already-accepted',
        sentAt: new Date(),
        deliveredAt: new Date(),
      },
    });
    await Promise.all([
      processOutboundMessage(scope, message.id, { attemptsMade: 1, maxAttempts: 4 }),
      processOutboundMessage(scope, message.id, { attemptsMade: 1, maxAttempts: 4 }),
    ]);
    expect(harness.messaging.sent).toHaveLength(0);
    expect((await systemDb.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'DELIVERED',
    );
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(1);
    expect(await systemDb.domainEvent.count({ where: { type: 'message.sent' } })).toBe(1);
    expect(countJobs(harness, 'domain-event.dispatch')).toBe(1);
  });

  it('falha transitória antes do aceite continua repetível sem consumo antecipado', async () => {
    const { scope, conversationId } = await setup();
    const message = await queueOutboundText(scope, {
      conversationId,
      sender: 'AGENT',
      text: 'Olá!',
    });
    harness.messaging.failNextWith = new WhatsAppApiError(
      'Temporariamente indisponível',
      503,
      131016,
      true,
    );
    await expect(
      processOutboundMessage(scope, message.id, { attemptsMade: 0, maxAttempts: 4 }),
    ).rejects.toThrow('Temporariamente');
    expect((await systemDb.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'QUEUED',
    );
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(0);
    await processOutboundMessage(scope, message.id, { attemptsMade: 1, maxAttempts: 4 });
    expect(harness.messaging.sent).toHaveLength(1);
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(1);
  });

  it('erro definitivo do provider continua visível como FAILED, sem aceite fictício', async () => {
    const { scope, conversationId } = await setup();
    const message = await queueOutboundText(scope, {
      conversationId,
      sender: 'AGENT',
      text: 'Olá!',
    });
    harness.messaging.failNextWith = new WhatsAppApiError('Token inválido', 401, 190, false);
    await processOutboundMessage(scope, message.id, { attemptsMade: 0, maxAttempts: 4 });
    expect(await systemDb.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: '190',
      externalId: null,
      sentAt: null,
    });
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(0);
    expect(await systemDb.notification.count({ where: { type: 'MESSAGE_FAILED' } })).toBe(1);
  });

  it('falha ao publicar message.sent mantém aceite e retry não reenvia nem duplica consumo', async () => {
    const { scope, conversationId } = await setup();
    const message = await queueOutboundText(scope, {
      conversationId,
      sender: 'AGENT',
      text: 'Olá!',
    });
    const enqueue = harness.queue.enqueue.bind(harness.queue);
    let failed = false;
    vi.spyOn(harness.queue, 'enqueue').mockImplementation(async (name, payload, options) => {
      if (name === 'domain-event.dispatch' && !failed) {
        failed = true;
        throw new Error('Redis indisponível');
      }
      await enqueue<JobName>(name, payload, options);
    });
    await expect(
      processOutboundMessage(scope, message.id, { attemptsMade: 0, maxAttempts: 4 }),
    ).rejects.toThrow('Redis indisponível');
    const accepted = await systemDb.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(accepted).toMatchObject({ status: 'SENT', failedAt: null, errorCode: null });
    expect(accepted.externalId).toMatch(/^wamid.mock/);
    expect(harness.messaging.sent).toHaveLength(1);
    expect(await systemDb.notification.count({ where: { type: 'MESSAGE_FAILED' } })).toBe(0);

    await processOutboundMessage(scope, message.id, { attemptsMade: 1, maxAttempts: 4 });
    expect(harness.messaging.sent).toHaveLength(1);
    expect(await systemDb.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(1);
    expect(await systemDb.domainEvent.count({ where: { type: 'message.sent' } })).toBe(1);
    expect(countJobs(harness, 'domain-event.dispatch')).toBe(1);
    await drainJobs(harness, { only: ['domain-event.dispatch'] });
    await processOutboundMessage(scope, message.id, { attemptsMade: 2, maxAttempts: 4 });
    expect(countJobs(harness, 'domain-event.dispatch')).toBe(0);
    expect(harness.messaging.sent).toHaveLength(1);
  });

  it('retry depois de mídia processada recupera resposta sem repetir download', async () => {
    const { scope, messageId } = await setup(true);
    const media = await systemDb.mediaAsset.findFirstOrThrow({ where: { messageId } });
    const download = vi.spyOn(harness.messaging, 'downloadMedia');
    const enqueue = harness.queue.enqueue.bind(harness.queue);
    let failed = false;
    vi.spyOn(harness.queue, 'enqueue').mockImplementation(async (name, payload, options) => {
      if (name === 'agent.reply' && !failed) {
        failed = true;
        throw new Error('Redis indisponível');
      }
      await enqueue<JobName>(name, payload, options);
    });
    await expect(
      processMediaAsset(scope, media.id, { attemptsMade: 0, maxAttempts: 4 }),
    ).rejects.toThrow('Redis indisponível');
    expect(
      (await systemDb.mediaAsset.findUniqueOrThrow({ where: { id: media.id } })).processingStatus,
    ).toBe('PROCESSED');
    await processMediaAsset(scope, media.id, { attemptsMade: 1, maxAttempts: 4 });
    expect(countJobs(harness, 'agent.reply')).toBe(1);
    expect(download).toHaveBeenCalledTimes(1);
    await systemDb.message.update({
      where: { id: messageId },
      data: { agentHandledAt: new Date() },
    });
    harness.queue.clear();
    await processMediaAsset(scope, media.id, { attemptsMade: 2, maxAttempts: 4 });
    expect(countJobs(harness, 'agent.reply')).toBe(0);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
