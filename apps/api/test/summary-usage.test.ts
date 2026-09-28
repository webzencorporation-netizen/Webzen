import { systemDb } from '@botsaas/database';
import { AIProviderError } from '@botsaas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { summarizeConversation } from '../src/modules/agent/summary';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';

let harness: TestHarness;
beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => {
  await harness.reset();
  harness.container.providers.ai = harness.ai;
});

async function fixture() {
  const company = await createCompanyFixture(harness, {
    name: 'Summary',
    ownerEmail: 'summary@usage.test',
  });
  const scope = systemScope(harness.container, company.id);
  const contact = await scope.db.contact.create({
    data: { companyId: company.id, phone: '551199998877' },
  });
  const conversation = await scope.db.conversation.create({
    data: { companyId: company.id, contactId: contact.id },
  });
  await scope.db.message.create({
    data: {
      companyId: company.id,
      conversationId: conversation.id,
      direction: 'INBOUND',
      sender: 'CONTACT',
      text: 'Quero atendimento amanhã.',
    },
  });
  return { scope, conversation };
}

describe('consumo do resumo', () => {
  it.each(['empty', 'whitespace', 'refusal'] as const)(
    '%s registra uso sem criar resumo',
    async (outcome) => {
      const { scope, conversation } = await fixture();
      harness.container.providers.ai = {
        name: 'mock',
        async complete(request) {
          const response = await harness.ai.complete(request);
          return {
            ...response,
            text: outcome === 'whitespace' ? ' \n ' : '',
            stopReason: outcome === 'refusal' ? 'refusal' : 'end_turn',
          };
        },
      };
      expect(await summarizeConversation(scope, conversation.id, 'threshold')).toBeNull();
      expect(await scope.db.conversationSummary.count()).toBe(0);
      const usage = await scope.db.usageRecord.findFirstOrThrow({ where: { kind: 'AI_CALL' } });
      expect(usage.conversationId).toBe(conversation.id);
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
      expect(harness.ai.requests).toHaveLength(1);
    },
  );

  it('preserva consumo se a persistência do resumo falhar após a resposta', async () => {
    const { scope, conversation } = await fixture();
    harness.ai.enqueue({ text: 'Cliente deseja atendimento amanhã.' });
    harness.container.providers.ai = {
      name: 'mock',
      async complete(request) {
        const response = await harness.ai.complete(request);
        // Exclusão concorrente faz o FK do resumo falhar, após consumir a resposta.
        await scope.db.conversation.delete({ where: { id: conversation.id } });
        return response;
      },
    };
    await expect(summarizeConversation(scope, conversation.id, 'threshold')).rejects.toThrow();
    expect(await scope.db.conversationSummary.count()).toBe(0);
    expect(
      await scope.db.usageRecord.count({
        where: { kind: 'AI_CALL', conversationId: conversation.id },
      }),
    ).toBe(1);
  });

  it('não inventa uso quando o provider lança sem retornar métricas', async () => {
    const { scope, conversation } = await fixture();
    harness.ai.enqueue({ error: new AIProviderError('Falha sem métricas', { retryable: true }) });
    await expect(summarizeConversation(scope, conversation.id, 'threshold')).rejects.toThrow(
      'Falha sem métricas',
    );
    expect(await scope.db.usageRecord.count()).toBe(0);
  });

  it('resumo normal registra uma chamada e não repete sem novas mensagens', async () => {
    const { scope, conversation } = await fixture();
    harness.ai.enqueue({ text: 'Cliente deseja atendimento amanhã.' });
    expect(await summarizeConversation(scope, conversation.id, 'threshold')).toContain('amanhã');
    expect(await summarizeConversation(scope, conversation.id, 'threshold')).toBeNull();
    expect(await scope.db.conversationSummary.count()).toBe(1);
    expect(await scope.db.usageRecord.count({ where: { kind: 'AI_CALL' } })).toBe(1);
    expect(harness.ai.requests).toHaveLength(1);
    expect(await systemDb.usageRecord.count()).toBe(1);
  });
});
