import type { ConversationChannel } from '@botsaas/database';
import type { CompanyScope } from '../../context';
import { emitDomainEvent } from '../../lib/events';
import { getEnabledFeatures } from '../features/service';

/** Encontra (ou cria) o contato pelo telefone. Não sobrescreve nome editado pela equipe. */
export async function findOrCreateContact(
  scope: CompanyScope,
  input: { phone: string; profileName?: string | null; source: string },
) {
  const existing = await scope.db.contact.findUnique({
    where: { companyId_phone: { companyId: scope.companyId, phone: input.phone } },
  });
  if (existing) {
    if (!existing.name && input.profileName) {
      return {
        contact: await scope.db.contact.update({
          where: { id: existing.id },
          data: { name: input.profileName },
        }),
        created: false,
      };
    }
    return { contact: existing, created: false };
  }
  try {
    const contact = await scope.db.contact.create({
      data: {
        companyId: scope.companyId,
        phone: input.phone,
        waId: input.phone,
        name: input.profileName ?? null,
        source: input.source,
      },
    });
    await emitDomainEvent(scope, 'contact.created', {
      contactId: contact.id,
      source: input.source,
    });
    return { contact, created: true };
  } catch (error) {
    // Corrida entre dois webhooks simultâneos do mesmo contato: relê o registro.
    const again = await scope.db.contact.findUnique({
      where: { companyId_phone: { companyId: scope.companyId, phone: input.phone } },
    });
    if (again) return { contact: again, created: false };
    throw error;
  }
}

/** Conversa aberta mais recente do contato (reabre se estiver encerrada). */
export async function findOrCreateConversation(
  scope: CompanyScope,
  input: { contactId: string; whatsappAccountId: string | null; channel: ConversationChannel },
) {
  const existing = await scope.db.conversation.findFirst({
    where: { contactId: input.contactId, channel: input.channel },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    if (existing.status === 'CLOSED') {
      return {
        conversation: await scope.db.conversation.update({
          where: { id: existing.id },
          data: { status: 'OPEN', closedAt: null },
        }),
        created: false,
      };
    }
    return { conversation: existing, created: false };
  }
  const conversation = await scope.db.conversation.create({
    data: {
      companyId: scope.companyId,
      contactId: input.contactId,
      whatsappAccountId: input.whatsappAccountId,
      channel: input.channel,
      mode: 'AI',
      status: 'OPEN',
    },
  });
  await emitDomainEvent(scope, 'conversation.created', {
    conversationId: conversation.id,
    contactId: input.contactId,
  });
  return { conversation, created: true };
}

/** Garante um lead no funil para novos contatos (quando o CRM está habilitado). */
export async function ensureLeadForContact(scope: CompanyScope, contactId: string, source: string) {
  const features = await getEnabledFeatures(scope);
  if (!features.has('CRM')) return null;
  const existing = await scope.db.lead.findFirst({ where: { contactId, closedAt: null } });
  if (existing) return existing;
  const firstStage = await scope.db.leadStage.findFirst({
    where: { isWon: false, isLost: false },
    orderBy: { position: 'asc' },
  });
  if (!firstStage) return null;
  const lead = await scope.db.lead.create({
    data: {
      companyId: scope.companyId,
      contactId,
      stageId: firstStage.id,
      source,
      position: Date.now(),
    },
  });
  await emitDomainEvent(scope, 'lead.created', { leadId: lead.id, contactId });
  return lead;
}
