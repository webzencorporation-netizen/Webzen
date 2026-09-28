import type { MockScriptStep } from '@botsaas/ai';
import { systemDb } from '@botsaas/database';
import { AIProviderError } from '@botsaas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { clearPricingCache } from '../src/modules/agent/pricing';
import { runConversationTurn } from '../src/modules/agent/runner';
import { emergencyStop } from '../src/modules/company/ai/service';
import {
  returnConversationToAi,
  setConversationPaused,
  takeOverConversation,
} from '../src/modules/messaging/handoff';
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
  clearPricingCache();
});

async function setupConversation() {
  const company = await createCompanyFixture(harness, {
    name: 'Empresa Interrupção',
    ownerEmail: 'owner@interruption.test',
  });
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: {
      enabled: true,
      respondOutsideHours: true,
      messageBufferSeconds: 0,
      fallbackBehavior: 'HANDOFF_TO_HUMAN',
      handoffMessage: 'A equipe vai atender você.',
    },
  });
  const owner = await systemDb.user.findUniqueOrThrow({
    where: { email: 'owner@interruption.test' },
  });
  const scope = systemScope(harness.container, company.id, {
    type: 'USER',
    userId: owner.id,
    label: 'Operador',
  });
  const account = await createWhatsAppAccount(company.id, 'interruption-number');
  const contact = await scope.db.contact.create({
    data: { companyId: company.id, phone: '5511999991111', name: 'Cliente' },
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
  return { scope, contact, conversation, message };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Suspende somente a resposta externa; engine, persistência e transições são reais. */
function holdProvider(step: MockScriptStep) {
  const started = deferred();
  const release = deferred();
  harness.ai.enqueue(step);
  harness.container.providers.ai = {
    name: 'mock',
    async complete(request) {
      started.resolve();
      await release.promise;
      return harness.ai.complete(request);
    },
  };
  return { started: started.promise, release: release.resolve };
}

const transitions = [
  'pause',
  'human',
  'emergency',
  'closed',
  'waiting',
  'deleted',
  'optedOut',
] as const;
type Transition = (typeof transitions)[number];
type Fixture = Awaited<ReturnType<typeof setupConversation>>;

async function interrupt(fixture: Fixture, transition: Transition) {
  const { scope, conversation, contact } = fixture;
  switch (transition) {
    case 'pause':
      await setConversationPaused(scope, conversation.id, true);
      break;
    case 'human':
      await takeOverConversation(scope, conversation.id);
      break;
    case 'emergency':
      await emergencyStop(scope);
      break;
    case 'closed':
      await scope.db.conversation.update({
        where: { id: conversation.id },
        data: { status: 'CLOSED' },
      });
      break;
    case 'waiting':
      await scope.db.conversation.update({
        where: { id: conversation.id },
        data: { status: 'WAITING_HUMAN' },
      });
      break;
    case 'deleted':
      await scope.db.conversation.delete({ where: { id: conversation.id } });
      break;
    case 'optedOut':
      await scope.db.contact.update({ where: { id: contact.id }, data: { optedOut: true } });
      break;
  }
}

describe('interrupção da IA enquanto o provider está em voo', () => {
  for (const result of ['success', 'error'] as const) {
    it.each(transitions)(
      `descarta ${result} tardio após %s e preserva estado do operador`,
      async (transition) => {
        const fixture = await setupConversation();
        const { scope, conversation, message } = fixture;
        const provider = holdProvider(
          result === 'success'
            ? { text: 'Resposta que chegou tarde.' }
            : { error: new AIProviderError('Falha tardia', { retryable: false }) },
        );
        const running = runConversationTurn(scope, conversation.id, {
          attemptsMade: 0,
          maxAttempts: 1,
        });
        await provider.started;
        try {
          await interrupt(fixture, transition);
        } finally {
          provider.release();
        }
        const outcome = await running;
        expect(outcome).toBe('skipped');
        const current = await scope.db.conversation.findUnique({ where: { id: conversation.id } });
        if (transition === 'deleted') {
          expect(current).toBeNull();
        } else {
          expect(current).toMatchObject({
            mode: transition === 'pause' ? 'PAUSED' : transition === 'human' ? 'HUMAN' : 'AI',
            status:
              transition === 'closed'
                ? 'CLOSED'
                : transition === 'waiting'
                  ? 'WAITING_HUMAN'
                  : 'OPEN',
            aiFailureCount: 2,
            needsAttention: false,
            attentionReason: null,
            assigneeId: transition === 'human' ? scope.actor.userId : null,
          });
          expect(await scope.db.message.findUnique({ where: { id: message.id } })).toMatchObject({
            agentHandledAt: null,
          });
        }
        expect(
          await scope.db.message.count({ where: { direction: 'OUTBOUND', type: 'TEXT' } }),
        ).toBe(0);
        expect(harness.queue.jobs.filter((job) => job.name === 'message.send')).toHaveLength(0);
        expect(await scope.db.notification.count({ where: { type: 'AGENT_FAILED' } })).toBe(0);
        expect(await scope.db.handoff.count()).toBe(transition === 'human' ? 1 : 0);
        const run = await scope.db.agentRun.findFirstOrThrow();
        expect(run.status).toBe(result === 'success' ? 'SUCCEEDED' : 'FAILED');
        expect(run.finishedAt).not.toBeNull();
        if (result === 'success') {
          expect(run.inputTokens).toBeGreaterThan(0);
          expect(Number(run.estimatedCostUsd)).toBeGreaterThan(0);
          expect(
            await scope.db.usageRecord.findFirst({ where: { kind: 'AI_CALL' } }),
          ).toMatchObject({ agentRunId: run.id, inputTokens: run.inputTokens });
        } else {
          expect(run.errorMessage).toBe('Falha tardia');
        }
      },
    );
  }

  it.each(['pause', 'human', 'emergency'] as const)(
    'não aplica fallback de recusa após %s',
    async (transition) => {
      const fixture = await setupConversation();
      const provider = holdProvider({ refusal: true });
      const running = runConversationTurn(fixture.scope, fixture.conversation.id, {
        attemptsMade: 0,
        maxAttempts: 1,
      });
      await provider.started;
      try {
        await interrupt(fixture, transition);
      } finally {
        provider.release();
      }
      expect(await running).toBe('skipped');
      expect(
        await fixture.scope.db.message.count({ where: { type: 'TEXT', direction: 'OUTBOUND' } }),
      ).toBe(0);
      expect(
        await fixture.scope.db.message.findUnique({ where: { id: fixture.message.id } }),
      ).toMatchObject({ agentHandledAt: null });
      expect(await fixture.scope.db.agentRun.findFirst()).toMatchObject({
        status: 'FAILED',
        errorCode: 'refused',
      });
      expect(await fixture.scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(1);
    },
  );

  it('não repete erro temporário quando a IA foi pausada durante a chamada', async () => {
    const fixture = await setupConversation();
    const provider = holdProvider({
      error: new AIProviderError('overloaded', { retryable: true }),
    });
    const running = runConversationTurn(fixture.scope, fixture.conversation.id, {
      attemptsMade: 0,
      maxAttempts: 3,
    });
    await provider.started;
    try {
      await interrupt(fixture, 'pause');
    } finally {
      provider.release();
    }
    await expect(running).resolves.toBe('skipped');
    expect(
      await fixture.scope.db.message.findUnique({ where: { id: fixture.message.id } }),
    ).toMatchObject({ agentHandledAt: null });
  });

  it('não publica resposta antiga quando humano assumiu e devolveu à IA antes do retorno', async () => {
    const fixture = await setupConversation();
    const provider = holdProvider({ text: 'Resposta antiga.' });
    const running = runConversationTurn(fixture.scope, fixture.conversation.id, {
      attemptsMade: 0,
      maxAttempts: 1,
    });
    await provider.started;
    try {
      await interrupt(fixture, 'human');
      await returnConversationToAi(fixture.scope, fixture.conversation.id);
    } finally {
      provider.release();
    }
    expect(await running).toBe('skipped');
    expect(await fixture.scope.db.message.count({ where: { sender: 'AI' } })).toBe(0);
    expect(
      (await fixture.scope.db.message.findUniqueOrThrow({ where: { id: fixture.message.id } }))
        .agentHandledAt,
    ).not.toBeNull();
  });

  it.each(['optedOut', 'closed', 'waiting'] as const)(
    'não consome IA se %s já está vigente no início',
    async (transition) => {
      const fixture = await setupConversation();
      await interrupt(fixture, transition);
      expect(
        await runConversationTurn(fixture.scope, fixture.conversation.id, {
          attemptsMade: 0,
          maxAttempts: 1,
        }),
      ).toBe('skipped');
      expect(harness.ai.requests).toHaveLength(0);
      expect(await fixture.scope.db.agentRun.count()).toBe(0);
      expect(await fixture.scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(0);
    },
  );

  it('publica normalmente se a conversa continua elegível', async () => {
    const fixture = await setupConversation();
    harness.ai.enqueue({ text: 'Resposta normal.' });
    expect(
      await runConversationTurn(fixture.scope, fixture.conversation.id, {
        attemptsMade: 0,
        maxAttempts: 1,
      }),
    ).toBe('responded');
    expect(await fixture.scope.db.message.findFirst({ where: { sender: 'AI' } })).toMatchObject({
      text: 'Resposta normal.',
      status: 'QUEUED',
    });
    expect(
      (await fixture.scope.db.message.findUniqueOrThrow({ where: { id: fixture.message.id } }))
        .agentHandledAt,
    ).not.toBeNull();
  });

  it('preserva confirmação antes do handoff solicitado pelo próprio resultado', async () => {
    const fixture = await setupConversation();
    harness.ai.enqueue(
      { toolCalls: [{ name: 'request_human_handoff', input: { reason: 'Pedido do cliente' } }] },
      { text: 'Vou chamar a equipe.' },
    );
    expect(
      await runConversationTurn(fixture.scope, fixture.conversation.id, {
        attemptsMade: 0,
        maxAttempts: 1,
      }),
    ).toBe('handoff');
    expect(await fixture.scope.db.message.findFirst({ where: { sender: 'AI' } })).toMatchObject({
      text: 'Vou chamar a equipe.',
      status: 'QUEUED',
    });
    expect(
      await fixture.scope.db.conversation.findUnique({ where: { id: fixture.conversation.id } }),
    ).toMatchObject({ mode: 'HUMAN', status: 'WAITING_HUMAN' });
    expect(await fixture.scope.db.handoff.findFirst()).toMatchObject({
      requestedBy: 'AI',
      reason: 'Pedido do cliente',
    });
  });
});
