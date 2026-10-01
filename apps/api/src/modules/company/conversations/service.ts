import type { Prisma } from '@botsaas/database';
import { NotFoundError, ValidationError } from '@botsaas/shared';
import { getMessagingWindow } from '@botsaas/whatsapp';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { emitDomainEvent } from '../../../lib/events';
import { toSkipTake, type PaginationQuery } from '../../../lib/http';
import { resolveCredentials } from '../../messaging/accounts';
import {
  addSystemNote,
  requestHandoff,
  returnConversationToAi,
  setConversationPaused,
  takeOverConversation,
} from '../../messaging/handoff';
import { queueOutboundTemplate, queueOutboundText } from '../../messaging/outbound';

export const INBOX_FILTERS = [
  'all',
  'unread',
  'ai',
  'human',
  'waiting',
  'unassigned',
  'mine',
  'attention',
  'closed',
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** Atendentes veem apenas conversas atribuídas a eles ou sem responsável (fila). */
function visibilityFilter(scope: CompanyScope): Prisma.ConversationWhereInput {
  if (scope.role === 'ATTENDANT' && scope.actor.userId) {
    return { OR: [{ assigneeId: scope.actor.userId }, { assigneeId: null }] };
  }
  return {};
}

function filterWhere(scope: CompanyScope, filter: InboxFilter): Prisma.ConversationWhereInput {
  switch (filter) {
    case 'unread':
      return { unreadCount: { gt: 0 }, status: { not: 'CLOSED' } };
    case 'ai':
      return { mode: 'AI', status: { not: 'CLOSED' } };
    case 'human':
      return { mode: 'HUMAN', status: { not: 'CLOSED' } };
    case 'waiting':
      return { status: 'WAITING_HUMAN' };
    case 'unassigned':
      return { assigneeId: null, status: { not: 'CLOSED' } };
    case 'mine':
      return { assigneeId: scope.actor.userId ?? '00000000-0000-0000-0000-000000000000' };
    case 'attention':
      return { needsAttention: true };
    case 'closed':
      return { status: 'CLOSED' };
    default:
      return { status: { not: 'CLOSED' } };
  }
}

const listInclude = {
  contact: {
    select: {
      id: true,
      name: true,
      phone: true,
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
    },
  },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof listInclude }>;

function toListItem(conversation: ConversationRow) {
  const window = getMessagingWindow(conversation.lastInboundAt);
  return {
    id: conversation.id,
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      phone: conversation.contact.phone,
      tags: conversation.contact.tags.map(({ tag }) => tag),
    },
    assignee: conversation.assignee,
    mode: conversation.mode,
    status: conversation.status,
    unreadCount: conversation.unreadCount,
    needsAttention: conversation.needsAttention,
    attentionReason: conversation.attentionReason,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    window: {
      isOpen: window.isOpen,
      expiresAt: window.expiresAt,
      requiresTemplate: window.requiresTemplate,
    },
  };
}

export async function listConversations(
  scope: CompanyScope,
  query: PaginationQuery & { filter: InboxFilter; search?: string; tagId?: string },
) {
  const where: Prisma.ConversationWhereInput = {
    AND: [
      { channel: 'WHATSAPP' },
      visibilityFilter(scope),
      filterWhere(scope, query.filter),
      query.search
        ? {
            contact: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search.replace(/\D/g, '') || query.search } },
              ],
            },
          }
        : {},
      query.tagId ? { contact: { tags: { some: { tagId: query.tagId } } } } : {},
    ],
  };
  const [total, items, counts] = await Promise.all([
    scope.db.conversation.count({ where }),
    scope.db.conversation.findMany({
      where,
      include: listInclude,
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      ...toSkipTake(query),
    }),
    conversationCounters(scope),
  ]);
  return {
    items: items.map(toListItem),
    total,
    page: query.page,
    pageSize: query.pageSize,
    counts,
  };
}

/** Contadores para as abas da caixa de entrada. */
export async function conversationCounters(scope: CompanyScope) {
  const base: Prisma.ConversationWhereInput = {
    AND: [{ channel: 'WHATSAPP' }, visibilityFilter(scope)],
  };
  const count = (extra: Prisma.ConversationWhereInput) =>
    scope.db.conversation.count({ where: { AND: [base, extra] } });
  const [unread, waiting, unassigned, attention] = await Promise.all([
    count({ unreadCount: { gt: 0 }, status: { not: 'CLOSED' } }),
    count({ status: 'WAITING_HUMAN' }),
    count({ assigneeId: null, status: { not: 'CLOSED' } }),
    count({ needsAttention: true }),
  ]);
  return { unread, waiting, unassigned, attention };
}

async function getVisibleConversation(scope: CompanyScope, id: string) {
  const conversation = await scope.db.conversation.findFirst({
    where: { AND: [{ id }, visibilityFilter(scope)] },
    include: listInclude,
  });
  if (!conversation) throw new NotFoundError('Conversa não encontrada.');
  return conversation;
}

export async function getConversation(scope: CompanyScope, id: string) {
  const conversation = await getVisibleConversation(scope, id);
  const [lead, openHandoff, account] = await Promise.all([
    scope.db.lead.findFirst({
      where: { contactId: conversation.contactId, closedAt: null },
      include: { stage: true },
    }),
    scope.db.handoff.findFirst({
      where: { conversationId: id, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    conversation.whatsappAccountId
      ? scope.db.whatsAppAccount.findUnique({
          where: { id: conversation.whatsappAccountId },
          select: { displayPhoneNumber: true, verifiedName: true },
        })
      : null,
  ]);
  return {
    ...toListItem(conversation),
    whatsappAccount: account,
    lead: lead
      ? {
          id: lead.id,
          stage: {
            id: lead.stage.id,
            key: lead.stage.key,
            name: lead.stage.name,
            color: lead.stage.color,
          },
          qualification: lead.qualification,
        }
      : null,
    openHandoff: openHandoff
      ? {
          id: openHandoff.id,
          reason: openHandoff.reason,
          requestedBy: openHandoff.requestedBy,
          createdAt: openHandoff.createdAt,
        }
      : null,
  };
}

export async function listMessages(
  scope: CompanyScope,
  conversationId: string,
  query: { before?: Date; limit: number },
) {
  await getVisibleConversation(scope, conversationId);
  const rows = await scope.db.message.findMany({
    where: { conversationId, ...(query.before ? { createdAt: { lt: query.before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      direction: true,
      sender: true,
      type: true,
      text: true,
      payload: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      agentRunId: true,
      senderUser: { select: { id: true, name: true } },
      media: {
        select: {
          id: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          fileName: true,
          caption: true,
          transcription: true,
          processingStatus: true,
          storageKey: true,
        },
      },
    },
  });
  return {
    items: rows.reverse().map(({ media, ...message }) => ({
      ...message,
      media: media.map(({ storageKey, ...item }) => ({ ...item, available: Boolean(storageKey) })),
    })),
    hasMore: rows.length === query.limit,
  };
}

export async function markConversationRead(scope: CompanyScope, conversationId: string) {
  const conversation = await getVisibleConversation(scope, conversationId);
  await scope.db.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  if (scope.container.providers.messaging.name === 'cloud' && conversation.unreadCount > 0) {
    const last = await scope.db.message.findFirst({
      where: { conversationId, direction: 'INBOUND', externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    });
    if (last?.externalId) {
      // Confirmação de leitura é best-effort: falha não impede o atendimento.
      resolveCredentials(scope, conversation.whatsappAccountId)
        .then(({ credentials }) =>
          scope.container.providers.messaging.markAsRead(credentials, last.externalId as string),
        )
        .catch((error: unknown) =>
          scope.container.logger.warn({ err: error }, 'Falha ao marcar como lida'),
        );
    }
  }
}

/** Resposta de funcionário. Se a IA estava ativa, a conversa passa automaticamente para humano. */
export async function replyAsAgent(scope: CompanyScope, conversationId: string, text: string) {
  const conversation = await getVisibleConversation(scope, conversationId);
  if (conversation.mode === 'AI') await takeOverConversation(scope, conversationId);
  else if (!conversation.assignee) {
    await scope.db.conversation.update({
      where: { id: conversationId },
      data: { assigneeId: scope.actor.userId ?? null },
    });
  }
  return queueOutboundText(scope, { conversationId, text, sender: 'AGENT' });
}

export async function sendTemplate(
  scope: CompanyScope,
  conversationId: string,
  input: { templateName: string; languageCode: string; bodyParameters: string[] },
) {
  await getVisibleConversation(scope, conversationId);
  return queueOutboundTemplate(scope, { conversationId, ...input, sender: 'AGENT' });
}

export async function assignConversation(
  scope: CompanyScope,
  conversationId: string,
  userId: string | null,
) {
  await getVisibleConversation(scope, conversationId);
  if (userId) {
    const member = await scope.db.companyMember.findFirst({
      where: { userId, isActive: true },
      include: { user: { select: { name: true } } },
    });
    if (!member) throw new ValidationError('Responsável não pertence à empresa.');
    await addSystemNote(scope, conversationId, `Conversa atribuída a ${member.user.name}.`);
  }
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: { assigneeId: userId },
  });
}

export async function changeMode(
  scope: CompanyScope,
  conversationId: string,
  action: 'take_over' | 'return_to_ai' | 'pause' | 'resume' | 'request_human',
) {
  await getVisibleConversation(scope, conversationId);
  switch (action) {
    case 'take_over':
      return takeOverConversation(scope, conversationId);
    case 'return_to_ai':
      return returnConversationToAi(scope, conversationId);
    case 'pause':
      return setConversationPaused(scope, conversationId, true);
    case 'resume':
      return setConversationPaused(scope, conversationId, false);
    case 'request_human':
      await requestHandoff(scope, conversationId, {
        requestedBy: 'AGENT',
        reason: 'Encaminhado manualmente pela equipe',
      });
      return;
  }
}

export async function setConversationStatus(
  scope: CompanyScope,
  conversationId: string,
  status: 'OPEN' | 'CLOSED',
) {
  await getVisibleConversation(scope, conversationId);
  await scope.db.conversation.update({
    where: { id: conversationId },
    data:
      status === 'CLOSED'
        ? { status, closedAt: new Date(), needsAttention: false, unreadCount: 0 }
        : { status, closedAt: null },
  });
  await addSystemNote(
    scope,
    conversationId,
    status === 'CLOSED' ? 'Conversa encerrada.' : 'Conversa reaberta.',
  );
  if (status === 'CLOSED') {
    const conversation = await scope.db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { contactId: true },
    });
    await emitDomainEvent(scope, 'conversation.closed', {
      conversationId,
      contactId: conversation.contactId,
    });
  }
}

/** Exclusão definitiva de conversa (LGPD). */
export async function deleteConversation(scope: CompanyScope, conversationId: string) {
  await getVisibleConversation(scope, conversationId);
  const media = await scope.db.mediaAsset.findMany({
    where: { message: { conversationId }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  // Não apagar a referência dos objetos que ainda precisam ser removidos.
  for (const item of media)
    if (item.storageKey) await scope.container.providers.storage.delete(item.storageKey);
  await scope.db.conversation.delete({ where: { id: conversationId } });
  await audit(scope, {
    action: 'conversation.deleted',
    resourceType: 'Conversation',
    resourceId: conversationId,
  });
}

/** Download de mídia via API autenticada (arquivos nunca ficam públicos). */
export async function getMediaForDownload(scope: CompanyScope, mediaId: string) {
  const media = await scope.db.mediaAsset.findUnique({
    where: { id: mediaId },
    include: { message: { select: { conversationId: true } } },
  });
  if (!media?.storageKey || !media.message) throw new NotFoundError('Mídia não encontrada.');
  await getVisibleConversation(scope, media.message.conversationId);
  const data = await scope.container.providers.storage.get(media.storageKey);
  return {
    data,
    mimeType: media.mimeType ?? 'application/octet-stream',
    fileName: media.fileName ?? `arquivo-${media.id}`,
  };
}
