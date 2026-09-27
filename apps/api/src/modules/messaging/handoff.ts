import type { HandoffRequester } from '@botsaas/database';
import { NotFoundError } from '@botsaas/shared';
import type { CompanyScope } from '../../context';
import { emitDomainEvent } from '../../lib/events';
import { notify } from '../../lib/notifications';

/** Mensagem interna (visível só no painel; nunca enviada ao WhatsApp). */
export async function addSystemNote(scope: CompanyScope, conversationId: string, text: string) {
  return scope.db.message.create({
    data: {
      companyId: scope.companyId,
      conversationId,
      direction: 'OUTBOUND',
      sender: 'SYSTEM',
      type: 'SYSTEM',
      text,
      status: 'SENT',
    },
  });
}

async function getConversation(scope: CompanyScope, conversationId: string) {
  const conversation = await scope.db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: { select: { name: true, phone: true } } },
  });
  if (!conversation) throw new NotFoundError('Conversa não encontrada.');
  return conversation;
}

/** Encaminha a conversa para humano (IA para de responder), registra motivo e avisa o painel. */
export async function requestHandoff(
  scope: CompanyScope,
  conversationId: string,
  input: { requestedBy: HandoffRequester; reason: string },
) {
  const conversation = await getConversation(scope, conversationId);
  const openHandoff = await scope.db.handoff.findFirst({
    where: { conversationId, resolvedAt: null },
  });
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: {
      mode: 'HUMAN',
      status: 'WAITING_HUMAN',
      needsAttention: true,
      attentionReason: input.reason.slice(0, 300),
    },
  });
  if (openHandoff) return openHandoff;

  const handoff = await scope.db.handoff.create({
    data: {
      companyId: scope.companyId,
      conversationId,
      requestedBy: input.requestedBy,
      requestedById: scope.actor.userId ?? null,
      reason: input.reason.slice(0, 500),
    },
  });
  await addSystemNote(
    scope,
    conversationId,
    `Atendimento encaminhado para a equipe. Motivo: ${input.reason}`,
  );
  await notify(scope, {
    type: 'HANDOFF_REQUESTED',
    severity: input.reason.startsWith('[URGENTE]') ? 'CRITICAL' : 'WARNING',
    title: `Atendimento humano solicitado — ${conversation.contact.name ?? conversation.contact.phone}`,
    body: input.reason,
    link: `/app/conversations/${conversationId}`,
  });
  await emitDomainEvent(scope, 'handoff.requested', {
    conversationId,
    handoffId: handoff.id,
    reason: input.reason,
    requestedBy: input.requestedBy,
  });
  return handoff;
}

/** Funcionário assume a conversa. */
export async function takeOverConversation(scope: CompanyScope, conversationId: string) {
  await getConversation(scope, conversationId);
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: {
      mode: 'HUMAN',
      status: 'OPEN',
      assigneeId: scope.actor.userId ?? null,
      needsAttention: false,
      attentionReason: null,
      unreadCount: 0,
    },
  });
  const open = await scope.db.handoff.findFirst({ where: { conversationId, resolvedAt: null } });
  if (open) {
    await scope.db.handoff.update({
      where: { id: open.id },
      data: { acceptedById: scope.actor.userId ?? null, acceptedAt: new Date() },
    });
  } else {
    await scope.db.handoff.create({
      data: {
        companyId: scope.companyId,
        conversationId,
        requestedBy: 'AGENT',
        requestedById: scope.actor.userId ?? null,
        reason: 'Atendente assumiu a conversa',
        acceptedById: scope.actor.userId ?? null,
        acceptedAt: new Date(),
      },
    });
  }
  await addSystemNote(
    scope,
    conversationId,
    `${scope.actor.label ?? 'Atendente'} assumiu a conversa.`,
  );
}

/**
 * Devolve a conversa para a IA. Mensagens já vistas pela equipe não são respondidas de novo e
 * um resumo do atendimento humano é gerado para dar contexto ao agente.
 */
export async function returnConversationToAi(scope: CompanyScope, conversationId: string) {
  await getConversation(scope, conversationId);
  const now = new Date();
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: {
      mode: 'AI',
      status: 'OPEN',
      needsAttention: false,
      attentionReason: null,
      aiFailureCount: 0,
    },
  });
  await scope.db.message.updateMany({
    where: { conversationId, direction: 'INBOUND', agentHandledAt: null },
    data: { agentHandledAt: now },
  });
  const open = await scope.db.handoff.findFirst({
    where: { conversationId, resolvedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (open) await scope.db.handoff.update({ where: { id: open.id }, data: { resolvedAt: now } });
  await addSystemNote(
    scope,
    conversationId,
    `${scope.actor.label ?? 'Atendente'} devolveu a conversa para a IA.`,
  );
  await scope.container.queue.enqueue(
    'conversation.summarize',
    { companyId: scope.companyId, conversationId, reason: 'handoff_return' },
    { jobId: `summary-return-${conversationId}-${now.getTime()}` },
  );
}

export async function setConversationPaused(
  scope: CompanyScope,
  conversationId: string,
  paused: boolean,
) {
  const conversation = await getConversation(scope, conversationId);
  if (!paused && conversation.mode !== 'PAUSED') return;
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: { mode: paused ? 'PAUSED' : 'AI' },
  });
  if (!paused) {
    await scope.db.message.updateMany({
      where: { conversationId, direction: 'INBOUND', agentHandledAt: null },
      data: { agentHandledAt: new Date() },
    });
  }
  await addSystemNote(
    scope,
    conversationId,
    paused ? 'IA pausada nesta conversa.' : 'IA retomada nesta conversa.',
  );
}
