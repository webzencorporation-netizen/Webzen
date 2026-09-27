import { decimalToNumber, systemDb, type Prisma } from '@botsaas/database';
import { periodStart, USAGE_PERIODS, type UsagePeriod } from '../../lib/time';

export interface AiUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  conversations: number;
  avgCostPerConversationUsd: number;
}

/**
 * Agregado de consumo da IA. `companyId` é OBRIGATÓRIO no escopo de empresa e opcional
 * apenas na visão da plataforma (todas as empresas).
 */
export async function summarizeAiUsage(filter: {
  companyId?: string;
  since: Date;
  includeTests?: boolean;
}): Promise<AiUsageSummary> {
  const where: Prisma.UsageRecordWhereInput = {
    kind: 'AI_CALL',
    occurredAt: { gte: filter.since },
    ...(filter.companyId ? { companyId: filter.companyId } : {}),
    ...(filter.includeTests ? {} : { isTest: false }),
  };
  const [aggregate, conversations] = await Promise.all([
    systemDb.usageRecord.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        costUsd: true,
      },
    }),
    systemDb.usageRecord.groupBy({
      by: ['conversationId'],
      where: { ...where, conversationId: { not: null } },
    }),
  ]);
  const costUsd = decimalToNumber(aggregate._sum.costUsd) ?? 0;
  return {
    calls: aggregate._count._all,
    inputTokens: aggregate._sum.inputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
    cacheReadTokens: aggregate._sum.cacheReadTokens ?? 0,
    cacheWriteTokens: aggregate._sum.cacheWriteTokens ?? 0,
    costUsd,
    conversations: conversations.length,
    avgCostPerConversationUsd:
      conversations.length > 0 ? Math.round((costUsd / conversations.length) * 1e6) / 1e6 : 0,
  };
}

export async function summarizeAiUsageByPeriod(filter: {
  companyId?: string;
  timezone: string;
  includeTests?: boolean;
}) {
  const entries = await Promise.all(
    USAGE_PERIODS.map(
      async (period) =>
        [
          period,
          await summarizeAiUsage({ ...filter, since: periodStart(period, filter.timezone) }),
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<UsagePeriod, AiUsageSummary>;
}

/** Custo por empresa (visão da plataforma). */
export async function costByCompany(since: Date) {
  const rows = await systemDb.usageRecord.groupBy({
    by: ['companyId'],
    where: { kind: 'AI_CALL', occurredAt: { gte: since } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
    orderBy: { _sum: { costUsd: 'desc' } },
    take: 100,
  });
  const companies = await systemDb.company.findMany({
    where: { id: { in: rows.map((row) => row.companyId) } },
    select: { id: true, name: true },
  });
  return rows.map((row) => ({
    companyId: row.companyId,
    companyName: companies.find((company) => company.id === row.companyId)?.name ?? '—',
    calls: row._count._all,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
    costUsd: decimalToNumber(row._sum.costUsd) ?? 0,
  }));
}

/** Custo por conversa (maiores), para identificar conversas caras. */
export async function costByConversation(companyId: string, since: Date, take = 20) {
  const rows = await systemDb.usageRecord.groupBy({
    by: ['conversationId'],
    where: {
      companyId,
      kind: 'AI_CALL',
      occurredAt: { gte: since },
      conversationId: { not: null },
    },
    _sum: { costUsd: true },
    _count: { _all: true },
    orderBy: { _sum: { costUsd: 'desc' } },
    take,
  });
  return rows.map((row) => ({
    conversationId: row.conversationId,
    calls: row._count._all,
    costUsd: decimalToNumber(row._sum.costUsd) ?? 0,
  }));
}
