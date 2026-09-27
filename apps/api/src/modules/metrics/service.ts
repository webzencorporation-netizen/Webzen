import { Prisma, systemDb } from '@botsaas/database';
import type { CompanyScope } from '../../context';
import { getOwnCompany } from '../../lib/company-record';
import { periodStart, type UsagePeriod } from '../../lib/time';
import { summarizeAiUsage } from '../usage/report';

async function distinctConversations(
  companyId: string,
  since: Date,
  where: Prisma.Sql,
): Promise<number> {
  const rows = await systemDb.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT m."conversationId") AS count
    FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE m."companyId" = ${companyId}::uuid AND c."channel" = 'WHATSAPP' AND m."createdAt" >= ${since} AND ${where}`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * Indicadores do painel da empresa. Só incluímos métricas calculáveis com os dados que temos;
 * conversas de teste (canal TEST) são excluídas. SQL cru sempre filtra companyId explicitamente.
 */
export async function getOverviewMetrics(scope: CompanyScope, period: UsagePeriod) {
  const company = await getOwnCompany(scope);
  const since = periodStart(period, company.timezone);
  const today = periodStart('today', company.timezone);
  const month = periodStart('month', company.timezone);
  const { companyId, db } = scope;

  const [
    conversationsToday,
    conversationsMonth,
    conversationsPeriod,
    aiHandled,
    humanHandled,
    newContacts,
    leadsCreated,
    leadsWon,
    handoffs,
    appointments,
    messagesSent,
    messagesReceived,
    answered,
    firstResponse,
    aiUsage,
  ] = await Promise.all([
    distinctConversations(companyId, today, Prisma.sql`m."direction" = 'INBOUND'`),
    distinctConversations(companyId, month, Prisma.sql`m."direction" = 'INBOUND'`),
    distinctConversations(companyId, since, Prisma.sql`m."direction" = 'INBOUND'`),
    distinctConversations(companyId, since, Prisma.sql`m."sender" = 'AI'`),
    distinctConversations(companyId, since, Prisma.sql`m."sender" = 'AGENT'`),
    db.contact.count({ where: { createdAt: { gte: since }, source: { not: 'test' } } }),
    db.lead.count({ where: { createdAt: { gte: since } } }),
    db.lead.count({ where: { closedAt: { gte: since }, stage: { isWon: true } } }),
    db.handoff.count({
      where: { createdAt: { gte: since }, conversation: { channel: 'WHATSAPP' } },
    }),
    db.appointment.count({ where: { createdAt: { gte: since } } }),
    db.message.count({
      where: {
        direction: 'OUTBOUND',
        sender: { in: ['AI', 'AGENT'] },
        status: { not: 'FAILED' },
        createdAt: { gte: since },
        conversation: { channel: 'WHATSAPP' },
      },
    }),
    db.message.count({
      where: {
        direction: 'INBOUND',
        createdAt: { gte: since },
        conversation: { channel: 'WHATSAPP' },
      },
    }),
    systemDb.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT m."conversationId") AS count
      FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE m."companyId" = ${companyId}::uuid AND c."channel" = 'WHATSAPP' AND m."direction" = 'INBOUND' AND m."createdAt" >= ${since}
        AND EXISTS (
          SELECT 1 FROM "Message" r
          WHERE r."conversationId" = m."conversationId" AND r."direction" = 'OUTBOUND'
            AND r."sender" IN ('AI', 'AGENT') AND r."createdAt" >= m."createdAt")`),
    systemDb.$queryRaw<{ avg: number | null; count: bigint }[]>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")))::float AS avg, COUNT(*) AS count
      FROM "Conversation"
      WHERE "companyId" = ${companyId}::uuid AND "channel" = 'WHATSAPP' AND "createdAt" >= ${since} AND "firstResponseAt" IS NOT NULL`),
    summarizeAiUsage({ companyId, since }),
  ]);

  const answeredCount = Number(answered[0]?.count ?? 0);
  return {
    period,
    since,
    conversations: {
      today: conversationsToday,
      month: conversationsMonth,
      period: conversationsPeriod,
    },
    newContacts,
    leads: { created: leadsCreated, won: leadsWon },
    attendance: { ai: aiHandled, human: humanHandled, handoffs },
    appointments,
    messages: { sent: messagesSent, received: messagesReceived },
    responseRate:
      conversationsPeriod > 0
        ? Math.round((answeredCount / conversationsPeriod) * 1000) / 10
        : null,
    avgFirstResponseSeconds:
      firstResponse[0]?.avg !== null && firstResponse[0]?.avg !== undefined
        ? Math.round(firstResponse[0].avg)
        : null,
    ai: { calls: aiUsage.calls, costUsd: aiUsage.costUsd },
  };
}

/** Série diária (fuso da empresa) de mensagens recebidas/enviadas para gráficos. */
export async function getDailySeries(scope: CompanyScope, days: number) {
  const company = await getOwnCompany(scope);
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const rows = await systemDb.$queryRaw<
    { day: string; inbound: bigint; outbound: bigint; conversations: bigint }[]
  >(Prisma.sql`
    SELECT to_char(date_trunc('day', m."createdAt" AT TIME ZONE ${company.timezone}), 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE m."direction" = 'INBOUND') AS inbound,
           COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND' AND m."sender" IN ('AI', 'AGENT')) AS outbound,
           COUNT(DISTINCT m."conversationId") AS conversations
    FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE m."companyId" = ${scope.companyId}::uuid AND c."channel" = 'WHATSAPP' AND m."createdAt" >= ${since}
    GROUP BY 1 ORDER BY 1`);
  return rows.map((row) => ({
    day: row.day,
    inbound: Number(row.inbound),
    outbound: Number(row.outbound),
    conversations: Number(row.conversations),
  }));
}
