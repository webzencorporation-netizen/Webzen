import { decimalToNumber, type Prisma } from '@botsaas/database';
import {
  LimitReachedError,
  USAGE_METRIC_LABELS,
  USAGE_METRICS,
  type UsageMetric,
  type UsageState,
} from '@botsaas/shared';
import type { CompanyScope } from '../../context';
import { getOwnCompany } from '../../lib/company-record';
import { monthStart, periodStart } from '../../lib/time';
import { getBillingAccess } from '../billing/access';

export { USAGE_METRICS };

export interface MetricStatus {
  metric: UsageMetric;
  label: string;
  current: number;
  limit: number | null;
  warningPercent: number;
  state: UsageState;
}

export function evaluateState(
  current: number,
  limit: number | null,
  warningPercent: number,
): UsageState {
  if (limit === null) return 'NORMAL';
  if (limit <= 0 || current >= limit) return 'LIMIT_REACHED';
  if (current >= (limit * warningPercent) / 100) return 'WARNING';
  return 'NORMAL';
}

const STATE_RANK: Record<UsageState, number> = { NORMAL: 0, WARNING: 1, LIMIT_REACHED: 2 };

export function worstState(states: UsageState[]): UsageState {
  return states.reduce<UsageState>(
    (worst, state) => (STATE_RANK[state] > STATE_RANK[worst] ? state : worst),
    'NORMAL',
  );
}

async function currentValues(
  scope: CompanyScope,
  since: Date,
): Promise<Record<UsageMetric, number>> {
  const { db } = scope;
  const [aiCalls, messages, aiCost, users, numbers, media, documents, automations] =
    await Promise.all([
      db.usageRecord.count({
        where: { kind: 'AI_CALL', isTest: false, occurredAt: { gte: since } },
      }),
      db.message.count({
        where: { direction: 'OUTBOUND', createdAt: { gte: since }, status: { not: 'FAILED' } },
      }),
      db.usageRecord.aggregate({
        where: { kind: 'AI_CALL', occurredAt: { gte: since } },
        _sum: { costUsd: true },
      }),
      db.companyMember.count({ where: { isActive: true } }),
      db.whatsAppAccount.count(),
      db.mediaAsset.aggregate({ _sum: { sizeBytes: true } }),
      db.knowledgeDocument.aggregate({ _sum: { sizeBytes: true } }),
      db.automation.count({ where: { isActive: true } }),
    ]);
  const storageBytes = (media._sum.sizeBytes ?? 0) + (documents._sum.sizeBytes ?? 0);
  return {
    AI_CALLS_PER_MONTH: aiCalls,
    MESSAGES_PER_MONTH: messages,
    AI_COST_USD_PER_MONTH: decimalToNumber(aiCost._sum.costUsd) ?? 0,
    USERS: users,
    WHATSAPP_NUMBERS: numbers,
    STORAGE_MB: Math.round((storageBytes / (1024 * 1024)) * 100) / 100,
    AUTOMATIONS: automations,
  };
}

/** Limites efetivos: sobrescrita da empresa > plano > ilimitado. */
export async function resolveLimits(
  scope: CompanyScope,
): Promise<Record<UsageMetric, { limit: number | null; warningPercent: number }>> {
  const [subscription, overrides] = await Promise.all([
    scope.db.subscription.findFirst({ include: { plan: true } }),
    scope.db.usageLimit.findMany(),
  ]);
  const planLimits = (subscription?.plan.limits ?? {}) as Prisma.JsonObject;
  const result = {} as Record<UsageMetric, { limit: number | null; warningPercent: number }>;
  for (const metric of USAGE_METRICS) {
    const override = overrides.find((item) => item.metric === metric);
    const planValue = planLimits[metric];
    result[metric] = override
      ? { limit: decimalToNumber(override.limitValue), warningPercent: override.warningPercent }
      : { limit: typeof planValue === 'number' ? planValue : null, warningPercent: 80 };
  }
  return result;
}

export async function getUsageStatus(scope: CompanyScope, now: Date = new Date()) {
  const company = await getOwnCompany(scope);
  const [limits, values] = await Promise.all([
    resolveLimits(scope),
    currentValues(scope, monthStart(company.timezone, now)),
  ]);
  const metrics: MetricStatus[] = USAGE_METRICS.map((metric) => ({
    metric,
    label: USAGE_METRIC_LABELS[metric],
    current: values[metric],
    limit: limits[metric].limit,
    warningPercent: limits[metric].warningPercent,
    state: evaluateState(values[metric], limits[metric].limit, limits[metric].warningPercent),
  }));
  return { state: worstState(metrics.map((metric) => metric.state)), metrics };
}

/**
 * A IA pode responder automaticamente? Considera limites do plano e orçamentos diário/mensal
 * da configuração do agente. Quando não pode, o fallback é encaminhar para humano — nunca
 * silenciar o atendimento de forma abrupta.
 */
export async function checkAiAllowance(
  scope: CompanyScope,
  now: Date = new Date(),
): Promise<{ allowed: boolean; reason?: string }> {
  const billing = await getBillingAccess(scope, now);
  if (!billing.allowed) return { allowed: false, reason: billing.reason };
  const status = await getUsageStatus(scope, now);
  for (const metric of ['AI_CALLS_PER_MONTH', 'AI_COST_USD_PER_MONTH'] as const) {
    const item = status.metrics.find((entry) => entry.metric === metric);
    if (item?.state === 'LIMIT_REACHED')
      return { allowed: false, reason: `Limite atingido: ${item.label}` };
  }
  const config = await scope.db.aIConfiguration.findFirst({
    select: { dailyBudgetUsd: true, monthlyBudgetUsd: true },
  });
  const company = await getOwnCompany(scope);
  if (config?.monthlyBudgetUsd) {
    const spent =
      status.metrics.find((entry) => entry.metric === 'AI_COST_USD_PER_MONTH')?.current ?? 0;
    if (spent >= (decimalToNumber(config.monthlyBudgetUsd) ?? Infinity)) {
      return { allowed: false, reason: 'Orçamento mensal da IA atingido' };
    }
  }
  if (config?.dailyBudgetUsd) {
    const today = await scope.db.usageRecord.aggregate({
      where: { kind: 'AI_CALL', occurredAt: { gte: periodStart('today', company.timezone, now) } },
      _sum: { costUsd: true },
    });
    if (
      (decimalToNumber(today._sum.costUsd) ?? 0) >=
      (decimalToNumber(config.dailyBudgetUsd) ?? Infinity)
    ) {
      return { allowed: false, reason: 'Orçamento diário da IA atingido' };
    }
  }
  return { allowed: true };
}

/** Verifica um limite de contagem antes de criar recursos (usuários, números...). */
export async function assertWithinLimit(
  scope: CompanyScope,
  metric: UsageMetric,
  increment = 1,
): Promise<void> {
  const status = await getUsageStatus(scope);
  const item = status.metrics.find((entry) => entry.metric === metric);
  if (item && item.limit !== null && item.current + increment > item.limit) {
    throw new LimitReachedError(`Limite do plano atingido: ${item.label} (${item.limit}).`);
  }
}
