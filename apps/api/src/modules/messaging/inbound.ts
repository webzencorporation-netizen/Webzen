import {
  isUniqueConstraintError,
  isTransactionConflictError,
  type Prisma,
} from '@botsaas/database';
import type { InboundMessage } from '@botsaas/whatsapp';
import type { CompanyDataScope, CompanyScope } from '../../context';
import { recordDomainEvent } from '../../lib/events';
import {
  findOrCreateContact,
  findOrCreateConversation,
  ensureLeadForContact,
} from './conversations';
import { messagePreview } from './preview';
import { scheduleAgentReply } from './schedule';

export interface IngestInboundInput {
  accountId: string | null;
  contact: { waId: string; profileName?: string };
  message: InboundMessage;
  channel?: 'WHATSAPP' | 'TEST';
}

export interface IngestResult {
  duplicate: boolean;
  messageId: string;
  conversationId: string;
  contactId: string;
}

function buildPayload(message: InboundMessage): Prisma.InputJsonValue | undefined {
  const payload: Record<string, unknown> = {};
  if (message.location) payload.location = message.location;
  if (message.contacts) payload.contacts = message.contacts;
  if (message.interactive) payload.interactive = message.interactive;
  if (message.button) payload.button = message.button;
  if (message.reaction) payload.reaction = message.reaction;
  if (message.errors) payload.errors = message.errors;
  return Object.keys(payload).length > 0 ? (payload as Prisma.InputJsonValue) : undefined;
}

/** Todos os efeitos no banco são confirmados juntos, antes de qualquer acesso à fila. */
async function persistInbound(
  scope: CompanyDataScope,
  input: IngestInboundInput,
): Promise<IngestResult> {
  const { message } = input;
  const duplicate = await scope.db.message.findFirst({
    where: { externalId: message.externalId },
    select: { id: true, conversationId: true, conversation: { select: { contactId: true } } },
  });
  if (duplicate)
    return {
      duplicate: true,
      messageId: duplicate.id,
      conversationId: duplicate.conversationId,
      contactId: duplicate.conversation.contactId,
    };

  const { contact, created: contactCreated } = await findOrCreateContact(
    scope,
    {
      phone: input.contact.waId,
      profileName: input.contact.profileName,
      source: 'whatsapp',
    },
    recordDomainEvent,
  );
  const { conversation } = await findOrCreateConversation(
    scope,
    {
      contactId: contact.id,
      whatsappAccountId: input.accountId,
      channel: input.channel ?? 'WHATSAPP',
    },
    recordDomainEvent,
  );
  const now = new Date();
  const receivedAt = message.timestamp > now ? now : message.timestamp;
  const stored = await scope.db.message.create({
    data: {
      companyId: scope.companyId,
      conversationId: conversation.id,
      direction: 'INBOUND',
      sender: 'CONTACT',
      type: message.type,
      text: message.text ?? null,
      payload: buildPayload(message),
      externalId: message.externalId,
      replyToExternalId: message.replyToExternalId ?? null,
      status: 'RECEIVED',
      createdAt: receivedAt,
      agentHandledAt: message.type === 'REACTION' ? now : null,
    },
  });
  if (message.media)
    await scope.db.mediaAsset.create({
      data: {
        companyId: scope.companyId,
        messageId: stored.id,
        kind: message.type,
        mimeType: message.media.mimeType ?? null,
        sha256: message.media.sha256 ?? null,
        caption: message.media.caption ?? null,
        fileName: message.media.filename ?? null,
        externalMediaId: message.media.id,
        processingStatus: 'PENDING',
      },
    });

  await scope.db.conversation.update({
    where: { id: conversation.id },
    data: {
      ...(!conversation.lastInboundAt || receivedAt > conversation.lastInboundAt
        ? { lastInboundAt: receivedAt }
        : {}),
      ...(!conversation.lastMessageAt || receivedAt >= conversation.lastMessageAt
        ? {
            lastMessageAt: receivedAt,
            lastMessagePreview: messagePreview(message.type, message.text),
          }
        : {}),
      unreadCount: { increment: 1 },
    },
  });
  if (!contact.lastInteractionAt || receivedAt > contact.lastInteractionAt) {
    await scope.db.contact.update({
      where: { id: contact.id },
      data: { lastInteractionAt: receivedAt },
    });
  }
  await scope.db.usageRecord.create({
    data: {
      companyId: scope.companyId,
      kind: 'MESSAGE_RECEIVED',
      conversationId: conversation.id,
      isTest: input.channel === 'TEST',
    },
  });
  if (contactCreated) await ensureLeadForContact(scope, contact.id, 'whatsapp', recordDomainEvent);
  await recordDomainEvent(scope, 'message.received', {
    messageId: stored.id,
    conversationId: conversation.id,
    contactId: contact.id,
    type: message.type,
  });
  return {
    duplicate: false,
    messageId: stored.id,
    conversationId: conversation.id,
    contactId: contact.id,
  };
}

/** Reconstitui os jobs a partir do estado confirmado; uma reentrega não repete efeitos no banco. */
async function dispatchInboundEffects(scope: CompanyScope, result: IngestResult): Promise<void> {
  const pendingEvents = await scope.db.domainEvent.findMany({
    where: {
      processedAt: null,
      OR: [
        { type: 'message.received', payload: { path: ['messageId'], equals: result.messageId } },
        { type: 'contact.created', payload: { path: ['contactId'], equals: result.contactId } },
        {
          type: 'conversation.created',
          payload: { path: ['conversationId'], equals: result.conversationId },
        },
        { type: 'lead.created', payload: { path: ['contactId'], equals: result.contactId } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const event of pendingEvents)
    await scope.container.queue.enqueue(
      'domain-event.dispatch',
      { companyId: scope.companyId, eventId: event.id },
      { jobId: `event-${event.id}` },
    );
  const message = await scope.db.message.findUnique({
    where: { id: result.messageId },
    select: {
      agentHandledAt: true,
      type: true,
      media: { select: { id: true, processingStatus: true } },
    },
  });
  if (!message) return;
  const pendingMedia = message.media.filter(
    (media) => media.processingStatus === 'PENDING' || media.processingStatus === 'DOWNLOADED',
  );
  for (const media of pendingMedia)
    await scope.container.queue.enqueue(
      'media.process',
      { companyId: scope.companyId, mediaAssetId: media.id },
      { jobId: `media-${media.id}` },
    );
  if (pendingMedia.length === 0 && !message.agentHandledAt && message.type !== 'REACTION') {
    await scheduleAgentReply(scope, result.conversationId);
  }
}

/** Registra entrada e outbox atomicamente. Redis pode ser recuperado pela reentrega/retry. */
export async function ingestInboundMessage(
  scope: CompanyScope,
  input: IngestInboundInput,
): Promise<IngestResult> {
  let result: IngestResult;
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await scope.db.$transaction((db) => persistInbound({ ...scope, db }, input), {
        isolationLevel: 'Serializable',
      });
      break;
    } catch (error) {
      const conflict = isUniqueConstraintError(error) || isTransactionConflictError(error);
      if (!conflict || attempt >= 4) throw error;
    }
  }
  await dispatchInboundEffects(scope, result);
  return result;
}
