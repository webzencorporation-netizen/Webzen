import type { Prisma } from '@botsaas/database';
import { NotFoundError } from '@botsaas/shared';
import type { CompanyScope } from '../../context';
import { audit } from '../../lib/audit';
import type { AutomationInput } from './types';

export function listAutomations(scope: CompanyScope) {
  return scope.db.automation.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createAutomation(scope: CompanyScope, input: AutomationInput) {
  const automation = await scope.db.automation.create({
    data: {
      companyId: scope.companyId,
      name: input.name,
      trigger: input.trigger,
      conditions: input.conditions as Prisma.InputJsonValue,
      actions: input.actions as Prisma.InputJsonValue,
      isActive: input.isActive,
    },
  });
  await audit(scope, {
    action: 'automation.created',
    resourceType: 'Automation',
    resourceId: automation.id,
    metadata: { trigger: input.trigger },
  });
  return automation;
}

export async function updateAutomation(
  scope: CompanyScope,
  id: string,
  input: Partial<AutomationInput>,
) {
  const exists = await scope.db.automation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new NotFoundError('Automação não encontrada.');
  return scope.db.automation.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
      ...(input.conditions !== undefined
        ? { conditions: input.conditions as Prisma.InputJsonValue }
        : {}),
      ...(input.actions !== undefined ? { actions: input.actions as Prisma.InputJsonValue } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteAutomation(scope: CompanyScope, id: string) {
  const result = await scope.db.automation.deleteMany({ where: { id } });
  if (result.count === 0) throw new NotFoundError('Automação não encontrada.');
  await audit(scope, { action: 'automation.deleted', resourceType: 'Automation', resourceId: id });
}

export function listAutomationRuns(scope: CompanyScope, automationId?: string) {
  return scope.db.automationRun.findMany({
    where: automationId ? { automationId } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
