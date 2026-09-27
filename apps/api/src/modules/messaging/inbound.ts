import type { Prisma } from '@botsaas/database';
import type { InboundMessage } from '@botsaas/whatsapp';
import type { CompanyScope } from '../../context';
import { emitDomainEvent } from '../../lib/events';
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
  messageId?: string;
  conversationId?: string;
  contactId?: string;
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

/**
 * Registra uma mensagem recebida do cliente: contato, conversa, mensagem, mídia, métricas,
 * eventos e (se aplicável) agenda a resposta da IA com agrupamento. Idempotente pelo wamid.
 */
export async function ingestInboundMessage(
  scope: CompanyScope,
  input: IngestInboundInput,
): Promise<IngestResult> {
  const { message } = input;
  const duplicate = await scope.db.message.findFirst({
    where: { externalId: message.externalId },
    select: { id: true },
  });
  if (duplicate) return { duplicate: true, messageId: duplicate.id };

  const { contact, created: contactCreated } = await findOrCreateContact(scope, {
    phone: input.contact.waId,
    profileName: input.contact.profileName,
    source: 'whatsapp',
  });
  const { conversation } = await findOrCreateConversation(scope, {
    contactId: contact.id,
    whatsappAccountId: input.accountId,
    channel: input.channel ?? 'WHATSAPP',
  });

  let stored;
  try {
    stored = await scope.db.message.create({
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
        createdAt: message.timestamp > new Date() ? new Date() : message.timestamp,
        // Reações não disparam o agente.
        agentHandledAt: message.type === 'REACTION' ? new Date() : null,
      },
    });
  } catch (error) {
    const again = await scope.db.message.findFirst({
      where: { externalId: message.externalId },
      select: { id: true },
    });
    if (again) return { duplicate: true, messageId: again.id };
    throw error;
  }

  if (message.media) {
    const media = await scope.db.mediaAsset.create({
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
    await scope.container.queue.enqueue(
      'media.process',
      { companyId: scope.companyId, mediaAssetId: media.id },
      { jobId: `media-${media.id}` },
    );
  }

  const now = new Date();
  await scope.db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastInboundAt: now,
      lastMessageAt: now,
      lastMessagePreview: messagePreview(message.type, message.text),
      unreadCount: { increment: 1 },
    },
  });
  await scope.db.contact.update({ where: { id: contact.id }, data: { lastInteractionAt: now } });
  await scope.db.usageRecord.create({
    data: {
      companyId: scope.companyId,
      kind: 'MESSAGE_RECEIVED',
      conversationId: conversation.id,
      isTest: input.channel === 'TEST',
    },
  });
  if (contactCreated) await ensureLeadForContact(scope, contact.id, 'whatsapp');
  await emitDomainEvent(scope, 'message.received', {
    messageId: stored.id,
    conversationId: conversation.id,
    contactId: contact.id,
    type: message.type,
  });

  // Mídias com processamento pendente (ex.: áudio) agendam o agente após o processamento.
  if (!message.media && message.type !== 'REACTION')
    await scheduleAgentReply(scope, conversation.id);

  return {
    duplicate: false,
    messageId: stored.id,
    conversationId: conversation.id,
    contactId: contact.id,
  };
}
