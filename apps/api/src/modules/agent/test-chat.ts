import { NotFoundError, RateLimitError } from '@botsaas/shared';
import { checkAiAllowance } from '../usage/limits';
import type { CompanyScope } from '../../context';
import { executeAgentTurn, DEFAULT_HANDOFF_MESSAGE } from './runner';

const TEST_PHONE_PREFIX = 'teste-painel-';

/** Conversa de simulação por usuário (canal TEST): nunca envia nada ao WhatsApp. */
async function ensureTestConversation(scope: CompanyScope, userKey: string) {
  const phone = `${TEST_PHONE_PREFIX}${userKey.slice(0, 12)}`;
  const contact =
    (await scope.db.contact.findUnique({
      where: { companyId_phone: { companyId: scope.companyId, phone } },
    })) ??
    (await scope.db.contact.create({
      data: { companyId: scope.companyId, phone, name: 'Cliente de teste', source: 'test' },
    }));
  const conversation =
    (await scope.db.conversation.findFirst({
      where: { contactId: contact.id, channel: 'TEST' },
    })) ??
    (await scope.db.conversation.create({
      data: {
        companyId: scope.companyId,
        contactId: contact.id,
        channel: 'TEST',
        mode: 'AI',
        status: 'OPEN',
      },
    }));
  return { ...conversation, contact };
}

export async function getTestConversation(scope: CompanyScope, userKey: string) {
  const conversation = await ensureTestConversation(scope, userKey);
  const messages = await scope.db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, sender: true, text: true, createdAt: true, agentRunId: true },
  });
  return { conversationId: conversation.id, messages };
}

/**
 * Simula uma mensagem de cliente e executa o agente com a configuração atual (mesmo se a IA
 * estiver desativada). Ações de escrita das tools são simuladas (dry-run).
 */
export async function runTestChat(scope: CompanyScope, userKey: string, text: string) {
  const conversation = await ensureTestConversation(scope, userKey);
  const config = await scope.db.aIConfiguration.findFirst();
  if (!config) throw new NotFoundError('Configure o agente antes de testar.');
  // O teste chama a IA paga: respeita os mesmos limites de plano e orçamento do atendimento.
  const allowance = await checkAiAllowance(scope);
  if (!allowance.allowed)
    throw new RateLimitError(`${allowance.reason ?? 'Limite de uso da IA atingido'}.`);

  await scope.db.message.create({
    data: {
      companyId: scope.companyId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      sender: 'CONTACT',
      type: 'TEXT',
      text,
      status: 'RECEIVED',
    },
  });
  await scope.db.conversation.update({
    where: { id: conversation.id },
    data: { lastInboundAt: new Date(), lastMessageAt: new Date() },
  });

  const pending = await scope.db.message.findMany({
    where: { conversationId: conversation.id, direction: 'INBOUND', agentHandledAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      sender: true,
      type: true,
      text: true,
      payload: true,
      media: {
        select: {
          id: true,
          mimeType: true,
          sizeBytes: true,
          storageKey: true,
          transcription: true,
          description: true,
          fileName: true,
          caption: true,
          processingStatus: true,
        },
      },
    },
  });

  const output = await executeAgentTurn(scope, {
    conversation,
    config,
    pending,
    trigger: 'TEST_CHAT',
    dryRun: true,
  });
  const { result } = output;
  const reply =
    result.text.trim() ||
    (result.effects.handoff ? (config.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE) : null);

  if (reply) {
    await scope.db.message.create({
      data: {
        companyId: scope.companyId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        sender: 'AI',
        type: 'TEXT',
        text: reply,
        status: 'SENT',
        sentAt: new Date(),
        agentRunId: output.agentRunId,
      },
    });
  }
  await scope.db.message.updateMany({
    where: { id: { in: pending.map((message) => message.id) } },
    data: { agentHandledAt: new Date(), agentRunId: output.agentRunId },
  });

  return {
    reply,
    debug: {
      outcome: result.outcome,
      model: output.model,
      durationMs: output.durationMs,
      iterations: result.iterations,
      usage: result.usage,
      estimatedCostUsd: output.costUsd,
      toolCalls: output.toolCalls,
      knowledge: output.knowledge,
      handoff: result.effects.handoff ?? null,
    },
  };
}

export async function resetTestChat(scope: CompanyScope, userKey: string) {
  const phone = `${TEST_PHONE_PREFIX}${userKey.slice(0, 12)}`;
  await scope.db.contact.deleteMany({ where: { phone } });
}
