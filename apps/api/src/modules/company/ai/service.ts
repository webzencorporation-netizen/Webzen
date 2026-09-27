import { composePromptSections, getBusinessTemplate, TOOL_METADATA, TOOL_NAMES } from '@botsaas/ai';
import { decimalToNumber, type AIConfiguration, type Prisma } from '@botsaas/database';
import {
  NotFoundError,
  ValidationError,
  type WeeklySchedule,
  formatWeeklySchedule,
  isOpenAt,
} from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { getOwnCompany } from '../../../lib/company-record';
import { toSkipTake, type PaginationQuery } from '../../../lib/http';
import { listAvailableModels } from '../../models/service';
import { formatAddress, type CompanyAddress } from '../settings/service';

export function toConfigDto(config: AIConfiguration) {
  return {
    ...config,
    dailyBudgetUsd: decimalToNumber(config.dailyBudgetUsd),
    monthlyBudgetUsd: decimalToNumber(config.monthlyBudgetUsd),
  };
}

async function requireConfig(scope: CompanyScope) {
  const config = await scope.db.aIConfiguration.findFirst();
  if (!config) throw new NotFoundError('Configuração do agente não encontrada.');
  return config;
}

export async function getAiSettings(scope: CompanyScope) {
  const [config, tools, company, models] = await Promise.all([
    requireConfig(scope),
    scope.db.aIToolConfiguration.findMany(),
    getOwnCompany(scope),
    listAvailableModels(),
  ]);
  const template = getBusinessTemplate(company.templateKey);
  return {
    config: {
      ...toConfigDto(config),
      effectiveModel: config.model ?? scope.container.env.AI_DEFAULT_MODEL,
    },
    tools: TOOL_NAMES.map((name) => ({
      name,
      label: TOOL_METADATA[name].label,
      category: TOOL_METADATA[name].category,
      mutating: TOOL_METADATA[name].mutating,
      enabled: tools.find((tool) => tool.toolName === name)?.enabled ?? false,
      recommended: template.tools.includes(name),
    })),
    models,
    defaultModel: scope.container.env.AI_DEFAULT_MODEL,
    provider: scope.container.providers.ai.name,
  };
}

const PROMPT_FIELDS: (keyof AIConfiguration)[] = [
  'personality',
  'tone',
  'responseLength',
  'emojiUsage',
  'additionalInstructions',
  'customRules',
  'greetingMessage',
  'outOfHoursMessage',
  'handoffMessage',
  'agentName',
];

export type AiConfigInput = Partial<
  Pick<
    AIConfiguration,
    | 'agentName'
    | 'personality'
    | 'tone'
    | 'responseLength'
    | 'emojiUsage'
    | 'additionalInstructions'
    | 'customRules'
    | 'greetingMessage'
    | 'outOfHoursMessage'
    | 'handoffMessage'
    | 'fallbackMessage'
    | 'messageBufferSeconds'
    | 'model'
    | 'maxOutputTokens'
    | 'effort'
    | 'maxToolIterations'
    | 'historyMessageLimit'
    | 'summaryThreshold'
    | 'fallbackBehavior'
    | 'respondOutsideHours'
    | 'enabled'
  > & { dailyBudgetUsd: number | null; monthlyBudgetUsd: number | null }
>;

export async function updateAiConfig(scope: CompanyScope, input: AiConfigInput) {
  const current = await requireConfig(scope);
  if (input.model) {
    const models = await listAvailableModels();
    if (!models.some((model) => model.id === input.model))
      throw new ValidationError('Modelo não disponível.');
  }
  const promptChanged = PROMPT_FIELDS.some(
    (field) =>
      field in input &&
      JSON.stringify(input[field as keyof AiConfigInput]) !== JSON.stringify(current[field]),
  );
  const updated = await scope.db.aIConfiguration.update({
    where: { id: current.id },
    data: {
      ...input,
      updatedById: scope.actor.userId ?? null,
      ...(promptChanged ? { version: { increment: 1 } } : {}),
    } as Prisma.AIConfigurationUpdateInput,
  });
  if (promptChanged) {
    await audit(scope, {
      action: 'ai.prompt_changed',
      resourceType: 'AIConfiguration',
      resourceId: current.id,
      metadata: { version: updated.version },
    });
  }
  if (input.enabled !== undefined && input.enabled !== current.enabled) {
    await audit(scope, {
      action: input.enabled ? 'ai.enabled' : 'ai.disabled',
      resourceType: 'AIConfiguration',
      resourceId: current.id,
    });
  }
  const otherFields = Object.keys(input).filter(
    (key) => !PROMPT_FIELDS.includes(key as keyof AIConfiguration) && key !== 'enabled',
  );
  if (otherFields.length > 0) {
    await audit(scope, {
      action: 'ai.settings_changed',
      resourceType: 'AIConfiguration',
      resourceId: current.id,
      metadata: { fields: otherFields },
    });
  }
  return toConfigDto(updated);
}

export async function setTools(scope: CompanyScope, tools: Record<string, boolean>) {
  for (const [name, enabled] of Object.entries(tools)) {
    if (!(TOOL_NAMES as string[]).includes(name))
      throw new ValidationError(`Ferramenta desconhecida: ${name}`);
    await scope.db.aIToolConfiguration.upsert({
      where: { companyId_toolName: { companyId: scope.companyId, toolName: name } },
      create: { companyId: scope.companyId, toolName: name, enabled },
      update: { enabled },
    });
  }
  await audit(scope, {
    action: 'ai.tools_changed',
    resourceType: 'AIToolConfiguration',
    metadata: { tools },
  });
  return getAiSettings(scope);
}

/** Preview do prompt final (com contexto de exemplo) para administradores autorizados. */
export async function previewPrompt(scope: CompanyScope) {
  const [config, company, holidays, sampleKnowledge] = await Promise.all([
    requireConfig(scope),
    getOwnCompany(scope),
    scope.db.holiday.findMany(),
    scope.db.knowledgeEntry.findMany({
      where: { isActive: true },
      take: 2,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  const schedule = (company.businessHours ?? []) as WeeklySchedule;
  const sections = composePromptSections({
    template: getBusinessTemplate(company.templateKey),
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
    agent: config,
    context: {
      now: new Date(),
      isOpenNow: isOpenAt(schedule, holidays, new Date(), company.timezone),
      channelLabel: 'WhatsApp',
      contact: { name: 'Cliente Exemplo', isNew: true, memories: [] },
      knowledge: sampleKnowledge.map((entry) => ({
        title: entry.title,
        content: entry.content.slice(0, 400),
      })),
    },
  });
  return {
    version: config.version,
    sections,
    note: 'O contexto atual é um exemplo; em produção ele é montado para cada conversa.',
  };
}

export async function listAgentRuns(
  scope: CompanyScope,
  query: PaginationQuery & {
    status?: 'SUCCEEDED' | 'FAILED';
    conversationId?: string;
    includeTests?: boolean;
  },
) {
  const where: Prisma.AgentRunWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.conversationId ? { conversationId: query.conversationId } : {}),
    ...(query.includeTests ? {} : { trigger: { not: 'TEST_CHAT' } }),
  };
  const [total, items] = await Promise.all([
    scope.db.agentRun.count({ where }),
    scope.db.agentRun.findMany({ where, orderBy: { startedAt: 'desc' }, ...toSkipTake(query) }),
  ]);
  return {
    items: items.map((run) => ({
      ...run,
      estimatedCostUsd: decimalToNumber(run.estimatedCostUsd),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** "Desativar IA da empresa" — botão de emergência. */
export async function emergencyStop(scope: CompanyScope) {
  const config = await requireConfig(scope);
  await scope.db.aIConfiguration.update({ where: { id: config.id }, data: { enabled: false } });
  await audit(scope, {
    action: 'ai.emergency_stop',
    resourceType: 'AIConfiguration',
    resourceId: config.id,
  });
}
