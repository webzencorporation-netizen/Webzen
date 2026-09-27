import {
  buildHistoryMessages,
  getBusinessTemplate,
  type HistoryMessage,
  type PromptInput,
} from '@botsaas/ai';
import type { AIConfiguration, Contact, Conversation } from '@botsaas/database';
import { formatWeeklySchedule, isOpenAt, type WeeklySchedule } from '@botsaas/shared';
import type { CompanyScope } from '../../context';
import { getOwnCompany } from '../../lib/company-record';
import { formatAddress, type CompanyAddress } from '../company/settings/service';
import { knowledgeRetriever, type KnowledgeHit } from '../knowledge/retriever';

export interface AgentContextInput {
  scope: CompanyScope;
  conversation: Conversation & { contact: Contact };
  config: AIConfiguration;
  /** Mensagens do cliente ainda não respondidas (serão o turno atual). */
  pending: { id: string; createdAt: Date }[];
  /** Texto agrupado do turno atual — usado na busca de conhecimento. */
  currentText: string;
  isTest: boolean;
}

const messageSelect = {
  id: true,
  sender: true,
  type: true,
  text: true,
  createdAt: true,
  payload: true,
  media: { select: { transcription: true, description: true, fileName: true, caption: true } },
} as const;

/** Carrega histórico relevante: mensagens após o resumo, limitadas, excluindo o turno atual. */
export async function loadHistory(
  scope: CompanyScope,
  conversationId: string,
  config: AIConfiguration,
  excludeIds: string[],
) {
  const summary = await scope.db.conversationSummary.findFirst({ where: { conversationId } });
  const rows = await scope.db.message.findMany({
    where: {
      conversationId,
      id: { notIn: excludeIds },
      ...(summary ? { createdAt: { gt: summary.coveredUntil } } : {}),
      NOT: { AND: [{ direction: 'OUTBOUND' }, { status: 'FAILED' }] },
    },
    orderBy: { createdAt: 'desc' },
    take: config.historyMessageLimit,
    select: messageSelect,
  });
  const history: HistoryMessage[] = rows
    .reverse()
    .map((row) => ({ ...row, media: row.media[0] ?? null }));
  return { summary, messages: buildHistoryMessages(history) };
}

export async function buildPromptInput(
  input: AgentContextInput,
): Promise<{ prompt: PromptInput; knowledge: KnowledgeHit[] }> {
  const { scope, conversation, config } = input;
  const company = await getOwnCompany(scope);
  const template = getBusinessTemplate(company.templateKey);
  const schedule = (company.businessHours ?? []) as WeeklySchedule;

  const [holidays, memories, lead, stages, fields, summary, knowledge, previousConversations] =
    await Promise.all([
      scope.db.holiday.findMany(),
      scope.db.contactMemory.findMany({
        where: { contactId: conversation.contactId },
        orderBy: { updatedAt: 'desc' },
        take: 15,
      }),
      scope.db.lead.findFirst({
        where: { contactId: conversation.contactId, closedAt: null },
        include: { stage: true },
      }),
      scope.db.leadStage.findMany({
        orderBy: { position: 'asc' },
        select: { key: true, name: true },
      }),
      scope.db.customFieldDefinition.findMany({
        where: { collectByAgent: true },
        orderBy: { position: 'asc' },
      }),
      scope.db.conversationSummary.findFirst({ where: { conversationId: conversation.id } }),
      input.currentText.trim()
        ? knowledgeRetriever.search(scope.companyId, input.currentText, 4)
        : Promise.resolve([]),
      scope.db.message.count({
        where: {
          conversation: { contactId: conversation.contactId },
          id: { notIn: input.pending.map((item) => item.id) },
        },
      }),
    ]);

  const contactFields = (conversation.contact.customFields ?? {}) as Record<string, unknown>;
  const qualification = (lead?.qualification ?? {}) as Record<string, unknown>;
  const fieldsToCollect = fields
    .filter(
      (field) =>
        (field.target === 'LEAD' ? qualification[field.key] : contactFields[field.key]) ===
        undefined,
    )
    .map((field) => ({
      key: field.key,
      label: field.label,
      hint: field.agentHint,
      target: field.target,
    }));

  const lastHandoff = await scope.db.handoff.findFirst({
    where: { conversationId: conversation.id, resolvedAt: { not: null } },
    orderBy: { resolvedAt: 'desc' },
  });

  const prompt: PromptInput = {
    template,
    company: {
      name: company.name,
      description: company.description,
      segment: company.segment,
      phone: company.phone,
      email: company.email,
      website: company.website,
      address: formatAddress(company.address as CompanyAddress | null),
      timezone: company.timezone,
      businessHoursText: formatWeeklySchedule(schedule),
    },
    agent: {
      agentName: config.agentName,
      personality: config.personality,
      tone: config.tone,
      responseLength: config.responseLength,
      emojiUsage: config.emojiUsage,
      additionalInstructions: config.additionalInstructions,
      customRules: config.customRules,
      greetingMessage: config.greetingMessage,
      outOfHoursMessage: config.outOfHoursMessage,
      handoffMessage: config.handoffMessage,
    },
    context: {
      now: new Date(),
      isOpenNow: isOpenAt(schedule, holidays, new Date(), company.timezone),
      channelLabel: input.isTest ? 'Simulação no painel' : 'WhatsApp',
      isTest: input.isTest,
      contact: {
        name: conversation.contact.name,
        isNew: previousConversations === 0,
        memories: memories.map((memory) => ({ key: memory.key, value: memory.value })),
        customFields: contactFields,
      },
      lead: lead ? { stageKey: lead.stage.key, stageName: lead.stage.name, qualification } : null,
      leadStages: stages,
      fieldsToCollect,
      conversationSummary: summary?.summary ?? null,
      humanHandoffNote:
        lastHandoff?.resolutionSummary &&
        lastHandoff.resolvedAt &&
        Date.now() - lastHandoff.resolvedAt.getTime() < 24 * 3600_000
          ? `Um atendente humano atendeu este cliente recentemente. Resumo: ${lastHandoff.resolutionSummary}`
          : null,
      knowledge: knowledge.map((hit) => ({
        title: hit.title,
        content: hit.content.slice(0, 1200),
      })),
    },
  };
  return { prompt, knowledge };
}
