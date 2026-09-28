import {
  isTransactionConflictError,
  type Prisma,
  type Message,
  type MessageSender,
} from '@botsaas/database';
import { ConflictError, NotFoundError, WhatsAppError } from '@botsaas/shared';
import { getMessagingWindow, WhatsAppApiError, type SendResult } from '@botsaas/whatsapp';
import type { CompanyScope } from '../../context';
import { getOwnCompany, isCompanyExecutionBlocked } from '../../lib/company-record';
import { recordDomainEvent } from '../../lib/events';
import { recordError } from '../../lib/error-log';
import { notify } from '../../lib/notifications';
import { resolveCredentials } from './accounts';
import { messagePreview } from './preview';

export interface OutboundTextInput {
  conversationId: string;
  text: string;
  sender: Exclude<MessageSender, 'CONTACT'>;
  agentRunId?: string | null;
}

async function loadConversation(scope: CompanyScope, conversationId: string) {
  const conversation = await scope.db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conversation) throw new NotFoundError('Conversa não encontrada.');
  return conversation;
}

async function afterOutboundCreated(
  scope: CompanyScope,
  conversationId: string,
  contactId: string,
  preview: string,
  sender: MessageSender,
) {
  const now = new Date();
  const conversation = await scope.db.conversation.findUnique({
    where: { id: conversationId },
    select: { firstResponseAt: true },
  });
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      lastMessagePreview: preview,
      ...(conversation?.firstResponseAt ? {} : { firstResponseAt: now }),
      ...(sender === 'AGENT' ? { unreadCount: 0 } : {}),
    },
  });
  await scope.db.contact.update({ where: { id: contactId }, data: { lastInteractionAt: now } });
}

/**
 * Enfileira uma mensagem de texto livre. Só é permitida dentro da janela de atendimento de 24h
 * — fora dela o atendente precisa usar um template aprovado.
 */
export async function queueOutboundText(scope: CompanyScope, input: OutboundTextInput) {
  const conversation = await loadConversation(scope, input.conversationId);
  const isTest = conversation.channel === 'TEST';
  if (!isTest) {
    const window = getMessagingWindow(conversation.lastInboundAt);
    if (window.requiresTemplate) {
      throw new ConflictError(
        'A janela de 24h está fechada. Envie um template aprovado para retomar a conversa.',
        {
          details: { requiresTemplate: true },
        },
      );
    }
    if (conversation.contact.optedOut)
      throw new ConflictError('O contato pediu para não receber mensagens.');
  }

  const message = await scope.db.message.create({
    data: {
      companyId: scope.companyId,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      sender: input.sender,
      senderUserId: input.sender === 'AGENT' ? (scope.actor.userId ?? null) : null,
      type: 'TEXT',
      text: input.text,
      status: isTest ? 'SENT' : 'QUEUED',
      sentAt: isTest ? new Date() : null,
      agentRunId: input.agentRunId ?? null,
    },
  });
  await afterOutboundCreated(
    scope,
    conversation.id,
    conversation.contactId,
    messagePreview('TEXT', input.text),
    input.sender,
  );
  if (!isTest) {
    await scope.container.queue.enqueue(
      'message.send',
      { companyId: scope.companyId, messageId: message.id },
      { jobId: `send-${message.id}` },
    );
  }
  return message;
}

export async function queueOutboundTemplate(
  scope: CompanyScope,
  input: {
    conversationId: string;
    templateName: string;
    languageCode: string;
    bodyParameters: string[];
    sender: 'AGENT' | 'SYSTEM';
  },
) {
  const conversation = await loadConversation(scope, input.conversationId);
  if (conversation.contact.optedOut)
    throw new ConflictError('O contato pediu para não receber mensagens.');
  const template = await scope.db.whatsAppTemplate.findFirst({
    where: { name: input.templateName, language: input.languageCode },
  });
  if (!template)
    throw new NotFoundError('Template não encontrado. Sincronize os templates do WhatsApp.');
  if (template.status !== 'APPROVED')
    throw new ConflictError('Template ainda não aprovado pela Meta.');

  const components = (template.components ?? []) as { type?: string; text?: string }[];
  const body =
    components.find((component) => component.type?.toUpperCase() === 'BODY')?.text ?? template.name;
  const rendered = body.replace(
    /\{\{(\d+)\}\}/g,
    (_, index: string) => input.bodyParameters[Number(index) - 1] ?? `{{${index}}}`,
  );

  const message = await scope.db.message.create({
    data: {
      companyId: scope.companyId,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      sender: input.sender,
      senderUserId: scope.actor.userId ?? null,
      type: 'TEMPLATE',
      text: rendered,
      payload: {
        templateName: input.templateName,
        languageCode: input.languageCode,
        bodyParameters: input.bodyParameters,
      } as Prisma.InputJsonValue,
      status: conversation.channel === 'TEST' ? 'SENT' : 'QUEUED',
    },
  });
  await afterOutboundCreated(
    scope,
    conversation.id,
    conversation.contactId,
    messagePreview('TEMPLATE', rendered),
    input.sender,
  );
  if (conversation.channel !== 'TEST') {
    await scope.container.queue.enqueue(
      'message.send',
      { companyId: scope.companyId, messageId: message.id },
      { jobId: `send-${message.id}` },
    );
  }
  return message;
}

export interface SendAttempt {
  attemptsMade: number;
  maxAttempts: number;
  jobId?: string;
}

/** Consumo e outbox são recuperáveis sem voltar a chamar o provider. */
async function completeOutboundEffects(
  scope: CompanyScope,
  message: Pick<Message, 'id' | 'conversationId' | 'sender'>,
): Promise<void> {
  let event: { id: string; processedAt: Date | null };
  for (let attempt = 0; ; attempt += 1) {
    try {
      event = await scope.db.$transaction(
        async (db) => {
          const existing = await db.domainEvent.findFirst({
            where: { type: 'message.sent', payload: { path: ['messageId'], equals: message.id } },
            select: { id: true, processedAt: true },
          });
          if (existing) return existing;
          await db.usageRecord.create({
            data: {
              companyId: scope.companyId,
              kind: 'MESSAGE_SENT',
              conversationId: message.conversationId,
            },
          });
          const id = await recordDomainEvent({ ...scope, db }, 'message.sent', {
            messageId: message.id,
            conversationId: message.conversationId,
            sender: message.sender,
          });
          return { id, processedAt: null };
        },
        { isolationLevel: 'Serializable' },
      );
      break;
    } catch (error) {
      if (!isTransactionConflictError(error) || attempt >= 4) throw error;
    }
  }
  if (!event.processedAt)
    await scope.container.queue.enqueue(
      'domain-event.dispatch',
      { companyId: scope.companyId, eventId: event.id },
      { jobId: `event-${event.id}` },
    );
}

/**
 * Processa o envio (job `message.send`). Idempotente: só envia mensagens em QUEUED.
 * Erros repetíveis relançam para o retry do job; os demais marcam FAILED e avisam o painel.
 */
export async function processOutboundMessage(
  scope: CompanyScope,
  messageId: string,
  attempt: SendAttempt,
): Promise<void> {
  const message = await scope.db.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { contact: true } } },
  });
  if (!message || message.direction !== 'OUTBOUND') return;
  // O aceite já persistido é definitivo para este job, mesmo se uma etapa local
  // posterior falhou ou um webhook já avançou o status de entrega.
  if (message.externalId && message.sentAt) {
    await completeOutboundEffects(scope, message);
    return;
  }
  if (message.status !== 'QUEUED') return;
  const { conversation } = message;
  const provider = scope.container.providers.messaging;
  let result: SendResult;

  try {
    // A fila pode ter atrasado ou o contato pode ter revogado o consentimento
    // depois do enqueue. Sempre revalidar antes de chamar o provider.
    if (conversation.contact.optedOut)
      throw new ConflictError('O contato pediu para não receber mensagens.');
    if (
      message.type !== 'TEMPLATE' &&
      getMessagingWindow(conversation.lastInboundAt).requiresTemplate
    )
      throw new ConflictError(
        'A janela de 24h está fechada. Envie um template aprovado para retomar a conversa.',
      );
    const { credentials } = await resolveCredentials(scope, conversation.whatsappAccountId);
    if (isCompanyExecutionBlocked((await getOwnCompany(scope)).status))
      throw new ConflictError('Envio bloqueado: empresa suspensa ou cancelada.');
    const payload = (message.payload ?? {}) as {
      templateName?: string;
      languageCode?: string;
      bodyParameters?: string[];
    };
    result =
      message.type === 'TEMPLATE' && payload.templateName && payload.languageCode
        ? await provider.sendTemplate(credentials, {
            to: conversation.contact.phone,
            templateName: payload.templateName,
            languageCode: payload.languageCode,
            bodyParameters: payload.bodyParameters,
          })
        : await provider.sendText(credentials, {
            to: conversation.contact.phone,
            text: message.text ?? '',
          });
  } catch (error) {
    const retryable = error instanceof WhatsAppError ? error.retryable : false;
    const isLastAttempt = attempt.attemptsMade + 1 >= attempt.maxAttempts;
    if (retryable && !isLastAttempt) throw error;

    const code =
      error instanceof WhatsAppApiError && error.graphCode !== undefined
        ? String(error.graphCode)
        : error instanceof ConflictError
          ? 'send_blocked'
          : 'send_failed';
    const reason = error instanceof Error ? error.message : 'Falha ao enviar';
    await scope.db.message.update({
      where: { id: message.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorCode: code,
        errorMessage: reason.slice(0, 500),
      },
    });
    await scope.db.conversation.update({
      where: { id: conversation.id },
      data: { needsAttention: true, attentionReason: 'Falha ao enviar mensagem' },
    });
    await notify(scope, {
      type: 'MESSAGE_FAILED',
      severity: 'WARNING',
      title: 'Falha ao enviar mensagem',
      body: reason,
      link: `/app/conversations/${conversation.id}`,
    });
    await recordError({
      source: 'WHATSAPP',
      code,
      message: reason,
      companyId: scope.companyId,
      conversationId: conversation.id,
      jobId: attempt.jobId,
    });
    return;
  }

  // Falhas locais após o aceite não são falhas de envio. Deixar o job repetir
  // permite concluir consumo/outbox a partir do ID externo sem reenviar.
  await scope.db.message.update({
    where: { id: message.id },
    data: {
      status: 'SENT',
      externalId: result.externalId,
      sentAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  await completeOutboundEffects(scope, message);
}
