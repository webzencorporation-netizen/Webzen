import { isUniqueConstraintError, type Prisma } from '@botsaas/database';
import type { AppContainer } from '../../container';
import type { CompanyScope } from '../../context';
import { emitDomainEvent } from '../../lib/events';
import { notify } from '../../lib/notifications';
import { systemScope } from '../../lib/scope';
import { addTagByName, createNote } from '../company/contacts/service';
import { queueOutboundTemplate, queueOutboundText } from '../messaging/outbound';
import { findOrCreateConversation } from '../messaging/conversations';
import {
  actionSchema,
  conditionSchema,
  type AutomationAction,
  type AutomationCondition,
} from './types';

export interface AutomationContext {
  event: { id: string; type: string };
  payload: Record<string, unknown>;
  contact?: { id: string; name: string | null; phone: string; email: string | null } | null;
  lead?: { id: string; stageKey: string } | null;
}

function readPath(context: AutomationContext, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      context,
    );
}

export function evaluateCondition(
  context: AutomationContext,
  condition: AutomationCondition,
): boolean {
  const actual = readPath(context, condition.field);
  switch (condition.op) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'not_exists':
      return actual === undefined || actual === null || actual === '';
    case 'eq':
      return String(actual) === String(condition.value);
    case 'neq':
      return String(actual) !== String(condition.value);
    case 'contains':
      return (
        typeof actual === 'string' &&
        actual.toLowerCase().includes(String(condition.value ?? '').toLowerCase())
      );
  }
}

/** Substitui {{contact.name}}, {{payload.x}} etc. por valores do contexto. */
export function interpolate(template: string, context: AutomationContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = readPath(context, path);
    return value === undefined || value === null ? '' : String(value);
  });
}

async function buildContext(
  scope: CompanyScope,
  event: { id: string; type: string; payload: Prisma.JsonValue },
): Promise<AutomationContext> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const contactId = typeof payload.contactId === 'string' ? payload.contactId : undefined;
  const contact = contactId
    ? await scope.db.contact.findUnique({
        where: { id: contactId },
        select: { id: true, name: true, phone: true, email: true },
      })
    : null;
  const lead = contactId
    ? await scope.db.lead.findFirst({
        where: { contactId, closedAt: null },
        include: { stage: { select: { key: true } } },
      })
    : null;
  return {
    event: { id: event.id, type: event.type },
    payload,
    contact,
    lead: lead ? { id: lead.id, stageKey: lead.stage.key } : null,
  };
}

async function conversationFor(scope: CompanyScope, contactId: string) {
  const { conversation } = await findOrCreateConversation(scope, {
    contactId,
    whatsappAccountId: null,
    channel: 'WHATSAPP',
  });
  return conversation;
}

async function executeAction(
  scope: CompanyScope,
  action: AutomationAction,
  context: AutomationContext,
): Promise<void> {
  const contactId = context.contact?.id;
  switch (action.type) {
    case 'add_tag':
      if (contactId) await addTagByName(scope, contactId, action.tagName);
      return;
    case 'notify_team':
      await notify(scope, {
        type: 'SYSTEM',
        title: interpolate(action.title, context),
        body: action.body ? interpolate(action.body, context) : undefined,
      });
      return;
    case 'create_note':
      if (contactId) await createNote(scope, contactId, interpolate(action.text, context));
      return;
    case 'send_message': {
      if (!contactId) return;
      const conversation = await conversationFor(scope, contactId);
      await queueOutboundText(scope, {
        conversationId: conversation.id,
        text: interpolate(action.text, context),
        sender: 'SYSTEM',
      });
      return;
    }
    case 'send_template': {
      if (!contactId) return;
      const conversation = await conversationFor(scope, contactId);
      await queueOutboundTemplate(scope, {
        conversationId: conversation.id,
        templateName: action.templateName,
        languageCode: action.languageCode,
        bodyParameters: action.bodyParameters.map((parameter) => interpolate(parameter, context)),
        sender: 'SYSTEM',
      });
      return;
    }
    case 'move_lead_stage': {
      if (!context.lead) return;
      const stage = await scope.db.leadStage.findFirst({ where: { key: action.stageKey } });
      if (!stage) throw new Error(`Etapa ${action.stageKey} não existe`);
      await scope.db.lead.update({
        where: { id: context.lead.id },
        data: { stageId: stage.id, closedAt: stage.isWon || stage.isLost ? new Date() : null },
      });
      await emitDomainEvent(scope, 'lead.stage_changed', {
        leadId: context.lead.id,
        contactId,
        toStageId: stage.id,
        by: 'AUTOMATION',
      });
      return;
    }
  }
}

/** Reações internas fixas (não configuráveis) a eventos. */
async function builtInReactions(scope: CompanyScope, type: string, context: AutomationContext) {
  if (type === 'lead.created' && context.contact) {
    await notify(scope, {
      type: 'NEW_LEAD',
      title: `Novo lead: ${context.contact.name ?? context.contact.phone}`,
      link: `/app/contacts/${context.contact.id}`,
    });
  }
}

/**
 * Job `domain-event.dispatch`: executa automações cujo gatilho é o evento.
 * Idempotente por (automação, evento) — um retry nunca executa ações duas vezes.
 */
export async function dispatchDomainEvent(
  container: AppContainer,
  payload: { companyId: string; eventId: string },
): Promise<void> {
  const scope = systemScope(container, payload.companyId, { type: 'SYSTEM', label: 'Automação' });
  const event = await scope.db.domainEvent.findUnique({ where: { id: payload.eventId } });
  if (!event || event.processedAt) return;
  const context = await buildContext(scope, event);

  await builtInReactions(scope, event.type, context);

  const automations = await scope.db.automation.findMany({
    where: { trigger: event.type, isActive: true },
  });
  for (const automation of automations) {
    const conditions = conditionSchema.array().safeParse(automation.conditions);
    const actions = actionSchema.array().safeParse(automation.actions);
    if (!conditions.success || !actions.success) continue;
    if (!conditions.data.every((condition) => evaluateCondition(context, condition))) continue;

    try {
      await scope.db.automationRun.create({
        data: {
          companyId: scope.companyId,
          automationId: automation.id,
          eventId: event.id,
          status: 'RUNNING',
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) continue;
      throw error;
    }
    try {
      for (const action of actions.data) await executeAction(scope, action, context);
      await scope.db.automationRun.updateMany({
        where: { automationId: automation.id, eventId: event.id },
        data: { status: 'SUCCEEDED' },
      });
    } catch (error) {
      await scope.db.automationRun.updateMany({
        where: { automationId: automation.id, eventId: event.id },
        data: {
          status: 'FAILED',
          error: (error instanceof Error ? error.message : 'erro').slice(0, 500),
        },
      });
    }
    await scope.db.automation.update({
      where: { id: automation.id },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });
  }
  await scope.db.domainEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
}
