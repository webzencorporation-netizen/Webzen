import { systemDb, type CompanyStatus } from '@botsaas/database';
import { AIProviderError } from '@botsaas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { executeAgentTurn, runConversationTurn } from '../src/modules/agent/runner';
import { summarizeConversation } from '../src/modules/agent/summary';
import {
  processOutboundMessage,
  queueOutboundTemplate,
  queueOutboundText,
} from '../src/modules/messaging/outbound';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';
import { createWhatsAppAccount } from './helpers/whatsapp';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => {
  await harness.reset();
  harness.container.providers.ai = harness.ai;
});
const attempt = { attemptsMade: 0, maxAttempts: 1 };

async function fixture(name = 'status') {
  const company = await createCompanyFixture(harness, { name, ownerEmail: `${name}@status.test` });
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: {
      enabled: true,
      respondOutsideHours: true,
      messageBufferSeconds: 0,
      fallbackBehavior: 'HANDOFF_TO_HUMAN',
      handoffMessage: 'Vou encaminhar.',
    },
  });
  const scope = systemScope(harness.container, company.id);
  const account = await createWhatsAppAccount(company.id, `number-${name}`);
  const contact = await scope.db.contact.create({
    data: { companyId: company.id, phone: '5511999991234' },
  });
  const conversation = await scope.db.conversation.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      whatsappAccountId: account.id,
      lastInboundAt: new Date(),
    },
  });
  const message = await scope.db.message.create({
    data: {
      companyId: company.id,
      conversationId: conversation.id,
      direction: 'INBOUND',
      sender: 'CONTACT',
      text: 'Olá',
      createdAt: new Date(Date.now() - 1000),
    },
  });
  await scope.db.whatsAppTemplate.create({
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
  harness.queue.clear();
  return { company, scope, conversation, message };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function status(companyId: string, next: CompanyStatus) {
  await systemDb.company.update({ where: { id: companyId }, data: { status: next } });
}

describe('estado da empresa nos jobs automáticos', () => {
  it.each(['SUSPENDED', 'CANCELLED'] as const)(
    '%s impede IA e resumo, preserva configuração e entradas',
    async (next) => {
      const { company, scope, conversation, message } = await fixture();
      await status(company.id, next);
      expect(await runConversationTurn(scope, conversation.id, attempt)).toBe('skipped');
      expect(await summarizeConversation(scope, conversation.id, 'threshold')).toBeNull();
      expect(harness.ai.requests).toHaveLength(0);
      expect(await scope.db.agentRun.count()).toBe(0);
      expect(await scope.db.usageRecord.count()).toBe(0);
      expect(await scope.db.aIConfiguration.findFirst()).toMatchObject({ enabled: true });
      expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
        agentHandledAt: null,
      });
    },
  );

  it.each(['SUSPENDED', 'CANCELLED'] as const)(
    '%s bloqueia resumo antes do provider',
    async (next) => {
      const { company, scope, conversation } = await fixture();
      await status(company.id, next);
      expect(await summarizeConversation(scope, conversation.id, 'handoff_return')).toBeNull();
      expect(harness.ai.requests).toHaveLength(0);
      expect(await scope.db.conversationSummary.count()).toBe(0);
    },
  );

  it('suspensão durante leitura de mídia impede primeira chamada automática', async () => {
    const { company, scope, conversation, message } = await fixture();
    await scope.db.message.update({ where: { id: message.id }, data: { type: 'IMAGE' } });
    await scope.db.mediaAsset.create({
      data: {
        companyId: company.id,
        messageId: message.id,
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        sizeBytes: 5,
        storageKey: 'image',
        processingStatus: 'PROCESSED',
      },
    });
    const entered = deferred();
    const release = deferred();
    const read = vi.spyOn(harness.storage, 'get').mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return Buffer.from('image');
    });
    const running = runConversationTurn(scope, conversation.id, attempt);
    try {
      await entered.promise;
      await status(company.id, 'SUSPENDED');
      release.resolve();
      expect(await running).toBe('skipped');
      expect(harness.ai.requests).toHaveLength(0);
      expect(await scope.db.agentRun.count()).toBe(0);
    } finally {
      release.resolve();
      read.mockRestore();
    }
  });

  it('suspensão durante criação do registro pula engine e classifica turno como SKIPPED', async () => {
    const { company, scope, conversation } = await fixture();
    scope.db = scope.db.$extends({
      query: {
        agentRun: {
          async create({ args, query }) {
            const record = await query(args);
            await status(company.id, 'SUSPENDED');
            return record;
          },
        },
      },
    });
    expect(await runConversationTurn(scope, conversation.id, attempt)).toBe('skipped');
    expect(harness.ai.requests).toHaveLength(0);
    expect(await scope.db.agentRun.findFirstOrThrow()).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'company_execution_blocked',
    });
    expect(await scope.db.usageRecord.count()).toBe(0);
  });

  it('teste manual explícito continua permitido sem enviar mensagem', async () => {
    const { company, scope, conversation } = await fixture();
    await status(company.id, 'SUSPENDED');
    const snapshot = await scope.db.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { contact: true },
    });
    const config = await scope.db.aIConfiguration.findFirstOrThrow();
    const pending = await scope.db.message.findMany({
      where: { conversationId: conversation.id },
      include: { media: true },
    });
    harness.ai.enqueue({ text: 'Simulação explícita' });
    const result = await executeAgentTurn(scope, {
      conversation: snapshot,
      config,
      pending,
      trigger: 'TEST_CHAT',
      dryRun: true,
    });
    expect(result.result.text).toBe('Simulação explícita');
    expect(await scope.db.usageRecord.findFirst()).toMatchObject({ isTest: true });
    expect(await scope.db.message.count({ where: { direction: 'OUTBOUND' } })).toBe(0);
  });

  it('resumo já em voo conclui e registra consumo após suspensão', async () => {
    const { company, scope, conversation } = await fixture();
    const entered = deferred();
    const release = deferred();
    harness.ai.enqueue({ text: 'Resumo do atendimento.' });
    harness.container.providers.ai = {
      name: 'mock',
      async complete(request) {
        entered.resolve();
        await release.promise;
        return harness.ai.complete(request);
      },
    };
    const running = summarizeConversation(scope, conversation.id, 'threshold');
    await entered.promise;
    await status(company.id, 'SUSPENDED');
    release.resolve();
    expect(await running).toBe('Resumo do atendimento.');
    expect(await scope.db.conversationSummary.count()).toBe(1);
    expect(await scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(1);
  });

  for (const next of ['SUSPENDED', 'CANCELLED'] as const) {
    it.each(['success', 'error'] as const)(
      `${next} durante provider descarta %s sem fallback, com registro do turno`,
      async (outcome) => {
        const { company, scope, conversation, message } = await fixture();
        const entered = deferred();
        const release = deferred();
        harness.ai.enqueue(
          outcome === 'success'
            ? { text: 'Resposta tardia' }
            : { error: new AIProviderError('Falha tardia', { retryable: false }) },
        );
        harness.container.providers.ai = {
          name: 'mock',
          async complete(request) {
            entered.resolve();
            await release.promise;
            return harness.ai.complete(request);
          },
        };
        const running = runConversationTurn(scope, conversation.id, attempt);
        await entered.promise;
        await status(company.id, next);
        release.resolve();
        expect(await running).toBe('skipped');
        expect(await scope.db.message.count({ where: { direction: 'OUTBOUND' } })).toBe(0);
        expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
          agentHandledAt: null,
        });
        expect(
          await scope.db.conversation.findUnique({ where: { id: conversation.id } }),
        ).toMatchObject({ mode: 'AI', status: 'OPEN', aiFailureCount: 0 });
        expect(await scope.db.agentRun.count()).toBe(1);
        expect(await scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(
          outcome === 'success' ? 1 : 0,
        );
      },
    );
    it.each(['text', 'template'] as const)(
      `${next} bloqueia %s QUEUED sem provider nem consumo`,
      async (kind) => {
        const { company, scope, conversation } = await fixture();
        const message =
          kind === 'text'
            ? await queueOutboundText(scope, {
                conversationId: conversation.id,
                text: 'Olá',
                sender: 'AGENT',
              })
            : await queueOutboundTemplate(scope, {
                conversationId: conversation.id,
                templateName: 'retomar',
                languageCode: 'pt_BR',
                bodyParameters: [],
                sender: 'AGENT',
              });
        await status(company.id, next);
        await processOutboundMessage(scope, message.id, attempt);
        expect(harness.messaging.sent).toHaveLength(0);
        expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
          status: 'FAILED',
          errorCode: 'send_blocked',
          externalId: null,
        });
        expect(await scope.db.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(0);
      },
    );
    it(`${next} permite completar aceite persistido sem reenviar`, async () => {
      const { company, scope, conversation } = await fixture();
      const message = await queueOutboundText(scope, {
        conversationId: conversation.id,
        text: 'Aceito',
        sender: 'AGENT',
      });
      await scope.db.message.update({
        where: { id: message.id },
        data: { status: 'DELIVERED', externalId: 'wamid.accepted', sentAt: new Date() },
      });
      await status(company.id, next);
      await processOutboundMessage(scope, message.id, attempt);
      await processOutboundMessage(scope, message.id, attempt);
      expect(harness.messaging.sent).toHaveLength(0);
      expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
        status: 'DELIVERED',
      });
      expect(await scope.db.usageRecord.count({ where: { kind: 'MESSAGE_SENT' } })).toBe(1);
      expect(await scope.db.domainEvent.count({ where: { type: 'message.sent' } })).toBe(1);
    });
  }

  it('reativação e outra empresa operam normalmente; ONBOARDING conserva comportamento', async () => {
    const first = await fixture('first');
    const other = await fixture('other');
    await status(first.company.id, 'SUSPENDED');
    await status(other.company.id, 'ONBOARDING');
    expect(await runConversationTurn(first.scope, first.conversation.id, attempt)).toBe('skipped');
    expect(await runConversationTurn(other.scope, other.conversation.id, attempt)).toBe(
      'responded',
    );
    const otherMessage = await other.scope.db.message.findFirstOrThrow({
      where: { direction: 'OUTBOUND' },
    });
    await processOutboundMessage(other.scope, otherMessage.id, attempt);
    expect(harness.messaging.sent).toHaveLength(1);
    await status(first.company.id, 'ACTIVE');
    expect(await runConversationTurn(first.scope, first.conversation.id, attempt)).toBe(
      'responded',
    );
    expect(await summarizeConversation(first.scope, first.conversation.id, 'threshold')).toEqual(
      expect.any(String),
    );
    expect(await first.scope.db.aIConfiguration.findFirst()).toMatchObject({ enabled: true });
  });
});
