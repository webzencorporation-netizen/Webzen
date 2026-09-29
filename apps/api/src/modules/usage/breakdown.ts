import { aiProviderForModel } from '@botsaas/config';
import { Prisma, systemDb } from '@botsaas/database';
import { ValidationError } from '@botsaas/shared';
import { localDateTimeToUtc } from '../calendar/availability';

/**
 * Relatório de consumo por dia, cliente e modelo/provedor — a base para a WebZen saber quanto
 * cada cliente gasta. IA: custo e tokens vêm de `UsageRecord` (turnos e resumos); execuções,
 * falhas e latência vêm de `AgentRun`. Testes do painel ficam de fora dos dois lados.
 * WhatsApp: mensagens que a Meta marcou como cobráveis (`Message.billable`), valoradas pela
 * tabela de preços por categoria; categoria sem preço fica sem custo (contada à parte).
 *
 * As consultas usam SQL cru no `systemDb` (agrupar por dia no fuso exige `AT TIME ZONE`), então
 * o filtro de empresa é explícito: na visão da empresa, `companyId` é OBRIGATÓRIO.
 */

export interface UsageBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Execuções do agente concluídas (sucesso ou falha). */
  runs: number;
  failedRuns: number;
  /** failedRuns / runs, 0 sem execuções. */
  errorRate: number;
  /** Média de `durationMs` das execuções que registraram duração. */
  avgDurationMs: number;
  /** Mensagens de saída que a Meta informou como cobráveis. */
  whatsappMessages: number;
  /** Custo estimado das mensagens cobráveis com preço conhecido. */
  whatsappCostUsd: number;
  /** Mensagens cobráveis de categorias sem preço configurado (fora de `whatsappCostUsd`). */
  whatsappUnpricedMessages: number;
}

export interface WhatsAppCategoryUsage {
  category: string;
  messages: number;
  /** null = sem preço configurado para a categoria. */
  unitPriceUsd: number | null;
  costUsd: number | null;
}

export interface UsageBreakdown {
  from: string;
  to: string;
  timezone: string;
  totals: UsageBucket;
  byDay: (UsageBucket & { day: string })[];
  byModel: (UsageBucket & { model: string; provider: string })[];
  byCompany?: (UsageBucket & { companyId: string; companyName: string })[];
  whatsappByCategory: WhatsAppCategoryUsage[];
}

const MAX_RANGE_DAYS = 366;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface UsageRow {
  day: string;
  companyId: string;
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string;
}

interface RunRow {
  day: string;
  companyId: string;
  model: string;
  provider: string;
  runs: number;
  failedRuns: number;
  durationSum: number;
  durationCount: number;
}

interface WhatsAppRow {
  day: string;
  companyId: string;
  category: string;
  messages: number;
}

interface Accumulator extends Omit<UsageBucket, 'errorRate' | 'avgDurationMs'> {
  durationSum: number;
  durationCount: number;
}

function emptyAccumulator(): Accumulator {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    runs: 0,
    failedRuns: 0,
    durationSum: 0,
    durationCount: 0,
    whatsappMessages: 0,
    whatsappCostUsd: 0,
    whatsappUnpricedMessages: 0,
  };
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function finish({ durationSum, durationCount, ...acc }: Accumulator): UsageBucket {
  return {
    ...acc,
    costUsd: round6(acc.costUsd),
    whatsappCostUsd: round6(acc.whatsappCostUsd),
    errorRate: acc.runs > 0 ? Math.round((acc.failedRuns / acc.runs) * 1e4) / 1e4 : 0,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
  };
}

/** Data local (AAAA-MM-DD) de um instante no fuso. */
export function localDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dayCount(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

/** Período padrão: do dia 1º do mês corrente até hoje, no fuso. */
export function resolveRange(
  input: { from?: string; to?: string },
  timezone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = localDate(now, timezone);
  const from = input.from ?? `${today.slice(0, 8)}01`;
  const to = input.to ?? today;
  for (const value of [from, to]) {
    if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
      throw new ValidationError('Datas no formato AAAA-MM-DD.');
  }
  if (to < from) throw new ValidationError('A data final deve ser igual ou posterior à inicial.');
  if (dayCount(from, to) > MAX_RANGE_DAYS)
    throw new ValidationError(`Período máximo de ${MAX_RANGE_DAYS} dias.`);
  return { from, to };
}

export async function usageBreakdown(filter: {
  from: string;
  to: string;
  timezone: string;
  /** Obrigatório na visão da empresa; na plataforma, opcional (todas as empresas). */
  companyId?: string;
  includeCompanies: boolean;
  /** Preço por mensagem cobrável, por categoria (ver `whatsappPriceTable`). */
  whatsappPrices: Record<string, number>;
}): Promise<UsageBreakdown> {
  const start = localDateTimeToUtc(filter.from, 0, filter.timezone);
  const end = localDateTimeToUtc(addDays(filter.to, 1), 0, filter.timezone);
  const company = filter.companyId
    ? Prisma.sql`AND "companyId" = ${filter.companyId}::uuid`
    : Prisma.empty;

  const [usageRows, runRows, whatsappRows] = await Promise.all([
    systemDb.$queryRaw<UsageRow[]>`
      SELECT to_char("occurredAt" AT TIME ZONE ${filter.timezone}, 'YYYY-MM-DD') AS "day",
             "companyId"::text AS "companyId",
             "model",
             count(*)::int AS "calls",
             coalesce(sum("inputTokens"), 0)::float8 AS "inputTokens",
             coalesce(sum("outputTokens"), 0)::float8 AS "outputTokens",
             coalesce(sum("cacheReadTokens"), 0)::float8 AS "cacheReadTokens",
             coalesce(sum("cacheWriteTokens"), 0)::float8 AS "cacheWriteTokens",
             coalesce(sum("costUsd"), 0)::text AS "costUsd"
        FROM "UsageRecord"
       WHERE "kind" = 'AI_CALL' AND NOT "isTest"
         AND "occurredAt" >= ${start} AND "occurredAt" < ${end}
         ${company}
       GROUP BY 1, 2, 3`,
    systemDb.$queryRaw<RunRow[]>`
      SELECT to_char("startedAt" AT TIME ZONE ${filter.timezone}, 'YYYY-MM-DD') AS "day",
             "companyId"::text AS "companyId",
             "model",
             "provider",
             count(*)::int AS "runs",
             (count(*) FILTER (WHERE "status" = 'FAILED'))::int AS "failedRuns",
             coalesce(sum("durationMs"), 0)::float8 AS "durationSum",
             count("durationMs")::int AS "durationCount"
        FROM "AgentRun"
       WHERE "status" IN ('SUCCEEDED', 'FAILED') AND "trigger" <> 'TEST_CHAT'
         AND "startedAt" >= ${start} AND "startedAt" < ${end}
         ${company}
       GROUP BY 1, 2, 3, 4`,
    systemDb.$queryRaw<WhatsAppRow[]>`
      SELECT to_char("createdAt" AT TIME ZONE ${filter.timezone}, 'YYYY-MM-DD') AS "day",
             "companyId"::text AS "companyId",
             coalesce("pricingCategory", 'desconhecida') AS "category",
             count(*)::int AS "messages"
        FROM "Message"
       WHERE "billable" = true
         AND "createdAt" >= ${start} AND "createdAt" < ${end}
         ${company}
       GROUP BY 1, 2, 3`,
  ]);

  // O provider registrado nas execuções vale para o modelo; sem execução, deduz pelo prefixo.
  const providerOf = new Map(runRows.map((row) => [row.model, row.provider]));
  const modelKey = (model: string | null) => model ?? 'desconhecido';
  const provider = (model: string | null) =>
    (model && (providerOf.get(model) ?? aiProviderForModel(model))) ?? 'desconhecido';

  const totals = emptyAccumulator();
  const byDay = new Map<string, Accumulator>();
  const byModel = new Map<string, Accumulator>();
  const byCompany = new Map<string, Accumulator>();
  const bucket = (map: Map<string, Accumulator>, key: string) => {
    let acc = map.get(key);
    if (!acc) map.set(key, (acc = emptyAccumulator()));
    return acc;
  };
  const targets = (day: string, model: string, companyId: string) => [
    totals,
    bucket(byDay, day),
    bucket(byModel, model),
    ...(filter.includeCompanies ? [bucket(byCompany, companyId)] : []),
  ];

  for (const row of usageRows) {
    for (const acc of targets(row.day, modelKey(row.model), row.companyId)) {
      acc.calls += row.calls;
      acc.inputTokens += row.inputTokens;
      acc.outputTokens += row.outputTokens;
      acc.cacheReadTokens += row.cacheReadTokens;
      acc.cacheWriteTokens += row.cacheWriteTokens;
      acc.costUsd += Number(row.costUsd);
    }
  }
  for (const row of runRows) {
    for (const acc of targets(row.day, row.model, row.companyId)) {
      acc.runs += row.runs;
      acc.failedRuns += row.failedRuns;
      acc.durationSum += row.durationSum;
      acc.durationCount += row.durationCount;
    }
  }

  // WhatsApp não tem modelo de IA: entra nos totais, por dia e por cliente, não em `byModel`.
  const byCategory = new Map<string, number>();
  for (const row of whatsappRows) {
    const price = filter.whatsappPrices[row.category];
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.messages);
    const accs = [
      totals,
      bucket(byDay, row.day),
      ...(filter.includeCompanies ? [bucket(byCompany, row.companyId)] : []),
    ];
    for (const acc of accs) {
      acc.whatsappMessages += row.messages;
      if (price === undefined) acc.whatsappUnpricedMessages += row.messages;
      else acc.whatsappCostUsd += price * row.messages;
    }
  }

  const report: UsageBreakdown = {
    from: filter.from,
    to: filter.to,
    timezone: filter.timezone,
    totals: finish(totals),
    byDay: [...byDay]
      .map(([day, acc]) => ({ day, ...finish(acc) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byModel: [...byModel]
      .map(([model, acc]) => ({ model, provider: provider(model), ...finish(acc) }))
      .sort((a, b) => b.costUsd - a.costUsd),
    whatsappByCategory: [...byCategory]
      .map(([category, messages]) => {
        const price = filter.whatsappPrices[category];
        return {
          category,
          messages,
          unitPriceUsd: price ?? null,
          costUsd: price === undefined ? null : round6(price * messages),
        };
      })
      .sort((a, b) => b.messages - a.messages),
  };
  if (filter.includeCompanies) {
    const names = await systemDb.company.findMany({
      where: { id: { in: [...byCompany.keys()] } },
      select: { id: true, name: true },
    });
    report.byCompany = [...byCompany]
      .map(([companyId, acc]) => ({
        companyId,
        companyName: names.find((row) => row.id === companyId)?.name ?? '—',
        ...finish(acc),
      }))
      .sort((a, b) => b.costUsd + b.whatsappCostUsd - (a.costUsd + a.whatsappCostUsd));
  }
  return report;
}
