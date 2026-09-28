import { systemDb } from '@botsaas/database';
import { AIProviderError } from '@botsaas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LockLeaseLostError, type LockLease } from '../src/lib/locks';
import { systemScope } from '../src/lib/scope';
import { runConversationTurn } from '../src/modules/agent/runner';
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const company = await createCompanyFixture(harness, {
    name: 'Lease',
    ownerEmail: 'owner@lease.test',
  });
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: {
      enabled: true,
      respondOutsideHours: true,
      messageBufferSeconds: 0,
      fallbackBehavior: 'HANDOFF_TO_HUMAN',
      handoffMessage: 'Encaminhando para equipe.',
    },
  });
  const scope = systemScope(harness.container, company.id, { type: 'AI', label: 'Teste' });
  const account = await createWhatsAppAccount(company.id, 'lease-account');
  const contact = await scope.db.contact.create({
    data: { companyId: company.id, phone: '5511987654321' },
  });
  const conversation = await scope.db.conversation.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      whatsappAccountId: account.id,
      lastInboundAt: new Date(),
      aiFailureCount: 2,
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
  harness.queue.clear();
  return { scope, conversation, message };
}

function controlledLease() {
  const controller = new AbortController();
  const error = new LockLeaseLostError();
  const lease: LockLease = {
    signal: controller.signal,
    assertOwned() {
      if (controller.signal.aborted) throw error;
    },
  };
  return { lease, lose: () => controller.abort(error) };
}

const attempt = { attemptsMade: 0, maxAttempts: 1 };
describe('runner após perder a lease', () => {
  it.each(['success', 'error', 'refusal', 'handoff', 'mutation'] as const)(
    '%s tardio preserva registro e entradas, sem publicar/fallback/alterar posse',
    async (outcome) => {
      const { scope, conversation, message } = await fixture();
      const { lease, lose } = controlledLease();
      const entered = deferred();
      const release = deferred();
      harness.ai.enqueue(
        outcome === 'error'
          ? { error: new AIProviderError('Falha tardia', { retryable: false }) }
          : outcome === 'mutation'
            ? {
                toolCalls: [
                  {
                    name: 'save_contact_memory',
                    input: { key: 'service_interest', value: 'Consulta' },
                  },
                ],
              }
            : outcome === 'refusal'
              ? { refusal: true }
              : outcome === 'handoff'
                ? {
                    toolCalls: [
                      { name: 'request_human_handoff', input: { reason: 'Pedido do cliente' } },
                    ],
                  }
                : { text: 'Resposta tardia' },
      );
      if (outcome === 'mutation') harness.ai.enqueue({ text: 'Memória salva.' });
      if (outcome === 'handoff') harness.ai.enqueue({ text: 'Você será atendido pela equipe.' });
      harness.container.providers.ai = {
        name: 'mock',
        async complete(request) {
          entered.resolve();
          await release.promise;
          return harness.ai.complete(request);
        },
      };
      const result = runConversationTurn(scope, conversation.id, attempt, lease).then(
        (value) => ({ value }),
        (error) => ({ error: error as Error }),
      );
      await entered.promise;
      lose();
      release.resolve();
      expect(await result).toMatchObject({ error: { name: 'LockLeaseLostError' } });
      expect(
        await scope.db.conversation.findUnique({ where: { id: conversation.id } }),
      ).toMatchObject({ mode: 'AI', status: 'OPEN', aiFailureCount: 2, needsAttention: false });
      expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
        agentHandledAt: null,
      });
      expect(await scope.db.message.count({ where: { direction: 'OUTBOUND' } })).toBe(0);
      expect(harness.queue.jobs.filter((job) => job.name === 'message.send')).toHaveLength(0);
      expect(await scope.db.agentRun.count()).toBe(1);
      expect(await scope.db.contactMemory.count()).toBe(0);
      if (outcome === 'mutation' || outcome === 'handoff') {
        expect((await scope.db.agentRun.findFirstOrThrow()).toolCalls).toEqual(
          expect.arrayContaining([expect.objectContaining({ ok: false, errorCode: 'lease_lost' })]),
        );
      }
      expect(await scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(
        outcome === 'error' ? 0 : 1,
      );
      expect(await systemDb.errorLog.count({ where: { source: 'AI' } })).toBe(0);
      expect(await scope.db.notification.count({ where: { type: 'AGENT_FAILED' } })).toBe(0);
    },
  );

  it('perda durante leitura de mídia impede a primeira chamada paga e registro de turno', async () => {
    const { scope, conversation, message } = await fixture();
    await scope.db.message.update({ where: { id: message.id }, data: { type: 'IMAGE' } });
    await scope.db.mediaAsset.create({
      data: {
        companyId: scope.companyId,
        messageId: message.id,
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        sizeBytes: 5,
        storageKey: 'slow-image',
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
    const { lease, lose } = controlledLease();
    const result = runConversationTurn(scope, conversation.id, attempt, lease).then(
      (value) => ({ value }),
      (error) => ({ error: error as Error }),
    );
    try {
      await entered.promise;
      lose();
      release.resolve();
      expect(await result).toMatchObject({ error: { name: 'LockLeaseLostError' } });
      expect(harness.ai.requests).toHaveLength(0);
      expect(await scope.db.agentRun.count()).toBe(0);
      expect(await scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(0);
    } finally {
      release.resolve();
      read.mockRestore();
    }
  });

  it('perda ao registrar turno pula a primeira chamada, sem classificar falha de IA', async () => {
    const { scope, conversation } = await fixture();
    const { lease, lose } = controlledLease();
    scope.db = scope.db.$extends({
      query: {
        agentRun: {
          async create({ args, query }) {
            const record = await query(args);
            lose();
            return record;
          },
        },
      },
    });
    await expect(runConversationTurn(scope, conversation.id, attempt, lease)).rejects.toThrow(
      /lease/,
    );
    expect(harness.ai.requests).toHaveLength(0);
    expect(await scope.db.agentRun.findFirstOrThrow()).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'lease_lost',
    });
    expect(await scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(0);
    expect(await systemDb.errorLog.count({ where: { source: 'AI' } })).toBe(0);
  });

  it('lease já perdida impede consumir IA ou marcar mensagens', async () => {
    const { scope, conversation, message } = await fixture();
    const { lease, lose } = controlledLease();
    lose();
    await expect(runConversationTurn(scope, conversation.id, attempt, lease)).rejects.toThrow(
      /lease/,
    );
    expect(await scope.db.agentRun.count()).toBe(0);
    expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
      agentHandledAt: null,
    });
  });
});
