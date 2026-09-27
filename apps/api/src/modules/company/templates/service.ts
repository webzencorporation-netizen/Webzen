import { getBusinessTemplate, TOOL_NAMES } from '@botsaas/ai';
import type { BusinessTemplateKey } from '@botsaas/shared';
import type { CompanyScope } from '../../../context';
import { audit } from '../../../lib/audit';
import { updateOwnCompany } from '../../../lib/company-record';

export interface ApplyTemplateOptions {
  /** true = também aplica os padrões do atendente (nome, tom, saudação). Use na criação. */
  includeAgentDefaults: boolean;
}

/**
 * Aplica um template de negócio à empresa. Idempotente: cria o que falta e ajusta as tools,
 * sem apagar etapas/campos existentes (podem ter dados vinculados).
 */
export async function applyBusinessTemplate(
  scope: CompanyScope,
  key: BusinessTemplateKey,
  options: ApplyTemplateOptions,
): Promise<void> {
  const template = getBusinessTemplate(key);
  const { db } = scope;

  await updateOwnCompany(scope, { templateKey: key, segment: template.name });

  const existingConfig = await db.aIConfiguration.findFirst();
  if (!existingConfig) {
    await db.aIConfiguration.create({
      data: {
        companyId: scope.companyId,
        agentName: template.agentDefaults.agentName,
        tone: template.agentDefaults.tone,
        responseLength: template.agentDefaults.responseLength,
        emojiUsage: template.agentDefaults.emojiUsage,
        greetingMessage: template.agentDefaults.greetingMessage,
        model: scope.container.env.AI_DEFAULT_MODEL,
      },
    });
  } else if (options.includeAgentDefaults) {
    await db.aIConfiguration.update({
      where: { id: existingConfig.id },
      data: {
        agentName: template.agentDefaults.agentName,
        tone: template.agentDefaults.tone,
        responseLength: template.agentDefaults.responseLength,
        emojiUsage: template.agentDefaults.emojiUsage,
        greetingMessage: template.agentDefaults.greetingMessage,
      },
    });
  }

  for (const toolName of TOOL_NAMES) {
    const enabled = template.tools.includes(toolName);
    await db.aIToolConfiguration.upsert({
      where: { companyId_toolName: { companyId: scope.companyId, toolName } },
      create: { companyId: scope.companyId, toolName, enabled },
      update: { enabled },
    });
  }

  const stages = await db.leadStage.findMany({ select: { key: true } });
  const existingStageKeys = new Set(stages.map((stage) => stage.key));
  const missingStages = template.leadStages
    .map((stage, position) => ({ ...stage, position }))
    .filter((stage) => !existingStageKeys.has(stage.key));
  if (missingStages.length > 0) {
    await db.leadStage.createMany({
      data: missingStages.map((stage) => ({
        companyId: scope.companyId,
        key: stage.key,
        name: stage.name,
        color: stage.color,
        position: stage.position,
        isWon: stage.isWon ?? false,
        isLost: stage.isLost ?? false,
      })),
    });
  }

  const fields = await db.customFieldDefinition.findMany({ select: { key: true, target: true } });
  const existingFields = new Set(fields.map((field) => `${field.target}:${field.key}`));
  const missingFields = template.customFields
    .map((field, position) => ({ ...field, position }))
    .filter((field) => !existingFields.has(`${field.target}:${field.key}`));
  if (missingFields.length > 0) {
    await db.customFieldDefinition.createMany({
      data: missingFields.map((field) => ({
        companyId: scope.companyId,
        target: field.target,
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options ?? [],
        collectByAgent: field.collectByAgent,
        agentHint: field.agentHint ?? null,
        position: field.position,
      })),
    });
  }

  await audit(scope, {
    action: 'company.template_applied',
    resourceType: 'Company',
    resourceId: scope.companyId,
    metadata: { template: key, includeAgentDefaults: options.includeAgentDefaults },
  });
}
