import { decimalToNumber, systemDb } from '@botsaas/database';

const PAYING = ['ACTIVE', 'PAST_DUE'] as const;
const DAY_MS = 24 * 3600_000;

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Indicadores SaaS da plataforma, calculados só com dados reais do banco.
 * - MRR: soma dos preços de tabela das assinaturas pagantes (anual ÷ 12). É uma estimativa
 *   pela tabela; descontos de cupom não entram. A receita efetiva vem das faturas pagas.
 * - Churn do mês: assinaturas que terminaram no mês ÷ pagantes no início do mês.
 * - Custos de IA ficam em US$ (sem conversão inventada para real).
 */
export async function getSaasMetrics(now: Date = new Date()) {
  const monthStart = monthStartUtc(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [
    users,
    activeUsers,
    companies,
    newCompanies,
    subscriptions,
    cancelledThisMonth,
    invoicesPaid,
    messages,
    aiCost,
    activeBots,
  ] = await Promise.all([
    systemDb.user.count({ where: { isActive: true, platformRole: null } }),
    systemDb.user.count({
      where: { isActive: true, platformRole: null, lastLoginAt: { gte: thirtyDaysAgo } },
    }),
    systemDb.company.count({ where: { status: { not: 'CANCELLED' } } }),
    systemDb.company.count({ where: { createdAt: { gte: monthStart } } }),
    systemDb.subscription.findMany({
      select: {
        status: true,
        interval: true,
        externalId: true,
        createdAt: true,
        cancelledAt: true,
        plan: {
          select: { key: true, name: true, priceMonthlyCents: true, priceYearlyCents: true },
        },
      },
    }),
    systemDb.subscription.count({
      where: { status: 'CANCELLED', cancelledAt: { gte: monthStart } },
    }),
    systemDb.invoice.aggregate({
      where: { status: 'PAID', paidAt: { gte: monthStart } },
      _sum: { amountPaidCents: true },
      _count: true,
    }),
    systemDb.message.count({ where: { createdAt: { gte: monthStart } } }),
    systemDb.usageRecord.aggregate({
      where: { kind: 'AI_CALL', isTest: false, occurredAt: { gte: monthStart } },
      _sum: { costUsd: true },
    }),
    systemDb.aIConfiguration.count({
      where: {
        enabled: true,
        company: { status: 'ACTIVE', whatsappAccounts: { some: { status: 'CONNECTED' } } },
      },
    }),
  ]);

  const paying = subscriptions.filter((subscription) =>
    (PAYING as readonly string[]).includes(subscription.status),
  );
  const monthlyCents = (subscription: (typeof subscriptions)[number]) =>
    subscription.interval === 'YEARLY'
      ? Math.round(
          (subscription.plan.priceYearlyCents ?? subscription.plan.priceMonthlyCents * 12) / 12,
        )
      : subscription.plan.priceMonthlyCents;
  const mrrCents = paying.reduce((sum, subscription) => sum + monthlyCents(subscription), 0);
  const payingAtMonthStart = subscriptions.filter(
    (subscription) =>
      subscription.createdAt < monthStart &&
      ((PAYING as readonly string[]).includes(subscription.status) ||
        (subscription.status === 'CANCELLED' &&
          subscription.cancelledAt !== null &&
          subscription.cancelledAt >= monthStart)),
  ).length;

  const byPlan = new Map<
    string,
    { key: string; name: string; customers: number; mrrCents: number }
  >();
  for (const subscription of paying) {
    const entry = byPlan.get(subscription.plan.key) ?? {
      key: subscription.plan.key,
      name: subscription.plan.name,
      customers: 0,
      mrrCents: 0,
    };
    entry.customers += 1;
    entry.mrrCents += monthlyCents(subscription);
    byPlan.set(subscription.plan.key, entry);
  }

  return {
    users: { total: users, activeLast30Days: activeUsers },
    companies: { total: companies, newThisMonth: newCompanies },
    subscriptions: {
      paying: paying.length,
      trialing: subscriptions.filter((subscription) => subscription.status === 'TRIALING').length,
      awaitingPayment: subscriptions.filter((subscription) => subscription.status === 'INCOMPLETE')
        .length,
      pastDue: subscriptions.filter((subscription) => subscription.status === 'PAST_DUE').length,
      cancelledThisMonth,
      churnRatePercent:
        payingAtMonthStart > 0
          ? Math.round((cancelledThisMonth / payingAtMonthStart) * 1000) / 10
          : null,
    },
    revenue: {
      mrrCents,
      arrCents: mrrCents * 12,
      paidThisMonthCents: invoicesPaid._sum.amountPaidCents ?? 0,
      invoicesPaidThisMonth: invoicesPaid._count,
      currency: 'BRL',
    },
    byPlan: [...byPlan.values()].sort((a, b) => b.mrrCents - a.mrrCents),
    usage: {
      activeBots,
      messagesThisMonth: messages,
      aiCostUsdThisMonth: decimalToNumber(aiCost._sum.costUsd) ?? 0,
    },
    generatedAt: now,
  };
}

/**
 * Receita × custo por empresa (últimos 30 dias): faturas pagas (R$) e custo de IA (US$),
 * lado a lado para descobrir quem custa mais do que paga. Sem câmbio inventado.
 */
export async function getCompanyEconomics(now: Date = new Date(), limit = 50) {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [revenue, cost] = await Promise.all([
    systemDb.invoice.groupBy({
      by: ['companyId'],
      where: { status: 'PAID', paidAt: { gte: since } },
      _sum: { amountPaidCents: true },
    }),
    systemDb.usageRecord.groupBy({
      by: ['companyId'],
      where: { kind: 'AI_CALL', isTest: false, occurredAt: { gte: since } },
      _sum: { costUsd: true },
      _count: true,
    }),
  ]);
  const ids = [
    ...new Set([...revenue.map((row) => row.companyId), ...cost.map((row) => row.companyId)]),
  ];
  const companies = await systemDb.company.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      subscription: { select: { plan: { select: { name: true } } } },
    },
  });
  const rows = companies.map((company) => {
    const paid = revenue.find((row) => row.companyId === company.id)?._sum.amountPaidCents ?? 0;
    const usage = cost.find((row) => row.companyId === company.id);
    return {
      companyId: company.id,
      name: company.name,
      plan: company.subscription?.plan.name ?? null,
      revenueCents: paid,
      aiCostUsd: decimalToNumber(usage?._sum.costUsd ?? null) ?? 0,
      aiCalls: usage?._count ?? 0,
    };
  });
  return rows.sort((a, b) => b.aiCostUsd - a.aiCostUsd).slice(0, limit);
}
