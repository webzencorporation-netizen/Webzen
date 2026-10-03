'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Building2, CircleDollarSign, MessagesSquare, Repeat, TrendingDown, UserCheck, Wallet } from 'lucide-react';
import { PageContainer } from '@/components/layout/company-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader, Skeleton, StatCard, Table, Td, Th } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatMoneyCents, formatNumber, formatUsd } from '@/lib/format';

interface SaasMetrics {
  users: { total: number; activeLast30Days: number };
  companies: { total: number; newThisMonth: number };
  subscriptions: { paying: number; trialing: number; awaitingPayment: number; pastDue: number; cancelledThisMonth: number; churnRatePercent: number | null };
  revenue: { mrrCents: number; arrCents: number; paidThisMonthCents: number; invoicesPaidThisMonth: number };
  byPlan: { key: string; name: string; customers: number; mrrCents: number }[];
  usage: { activeBots: number; messagesThisMonth: number; aiCostUsdThisMonth: number };
}

interface EconomicsRow {
  companyId: string;
  name: string;
  plan: string | null;
  revenueCents: number;
  aiCostUsd: number;
  aiCalls: number;
}

export function PlatformOverviewPage() {
  const metrics = useQuery({ queryKey: ['platform-saas-metrics'], queryFn: () => api.get<SaasMetrics>('/platform/metrics/saas') });
  const economics = useQuery({ queryKey: ['platform-economics'], queryFn: () => api.get<EconomicsRow[]>('/platform/metrics/economics') });
  const data = metrics.data;
  const loading = metrics.isLoading;
  return (
    <PageContainer>
      <PageHeader title="Indicadores" description="Receita, clientes e uso da plataforma. MRR e ARR pelos preços de tabela; receita efetiva pelas faturas pagas." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="MRR estimado" value={data ? formatMoneyCents(data.revenue.mrrCents) : '—'} hint={data ? `ARR ${formatMoneyCents(data.revenue.arrCents)}` : undefined} icon={Repeat} loading={loading} />
        <StatCard label="Recebido no mês" value={data ? formatMoneyCents(data.revenue.paidThisMonthCents) : '—'} hint={data ? `${formatNumber(data.revenue.invoicesPaidThisMonth)} faturas pagas` : undefined} icon={Wallet} loading={loading} />
        <StatCard label="Assinantes" value={formatNumber(data?.subscriptions.paying)} hint={data ? `${data.subscriptions.trialing} em teste · ${data.subscriptions.awaitingPayment} aguardando pagamento` : undefined} icon={CircleDollarSign} loading={loading} />
        <StatCard
          label="Cancelamentos no mês"
          value={formatNumber(data?.subscriptions.cancelledThisMonth)}
          hint={data?.subscriptions.churnRatePercent !== null && data?.subscriptions.churnRatePercent !== undefined ? `churn de ${data.subscriptions.churnRatePercent}%` : 'sem base para churn'}
          icon={TrendingDown}
          loading={loading}
        />
        <StatCard label="Empresas" value={formatNumber(data?.companies.total)} hint={data ? `${data.companies.newThisMonth} novas no mês` : undefined} icon={Building2} loading={loading} />
        <StatCard label="Usuários ativos" value={formatNumber(data?.users.activeLast30Days)} hint={data ? `de ${formatNumber(data.users.total)} usuários · 30 dias` : undefined} icon={UserCheck} loading={loading} />
        <StatCard label="Bots no ar" value={formatNumber(data?.usage.activeBots)} hint="IA ligada e WhatsApp conectado" icon={Bot} loading={loading} />
        <StatCard label="Mensagens no mês" value={formatNumber(data?.usage.messagesThisMonth)} hint={data ? `custo de IA ${formatUsd(data.usage.aiCostUsdThisMonth)}` : undefined} icon={MessagesSquare} loading={loading} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="min-w-0">
          <CardHeader title="Receita por plano" description="Assinaturas pagantes (ativas ou com pagamento atrasado)." />
          {!data ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : data.byPlan.length === 0 ? (
            <EmptyState title="Nenhum assinante pagante ainda" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Plano</Th>
                  <Th>Clientes</Th>
                  <Th>MRR</Th>
                </tr>
              </thead>
              <tbody>
                {data.byPlan.map((plan) => (
                  <tr key={plan.key}>
                    <Td className="font-medium">{plan.name}</Td>
                    <Td className="tabular-nums">{plan.customers}</Td>
                    <Td className="tabular-nums">{formatMoneyCents(plan.mrrCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Receita × custo de IA por empresa" description="Últimos 30 dias, ordenado pelo custo. Valores em moedas diferentes: compare com o câmbio do dia." />
          {!economics.data ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : economics.data.length === 0 ? (
            <EmptyState title="Sem receita nem uso de IA no período" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Empresa</Th>
                  <Th>Plano</Th>
                  <Th>Recebido</Th>
                  <Th>Custo de IA</Th>
                  <Th>Chamadas</Th>
                </tr>
              </thead>
              <tbody>
                {economics.data.map((row) => (
                  <tr key={row.companyId}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td className="text-muted">{row.plan ?? '—'}</Td>
                    <Td className="tabular-nums">{formatMoneyCents(row.revenueCents)}</Td>
                    <Td className="tabular-nums">{formatUsd(row.aiCostUsd)}</Td>
                    <Td className="tabular-nums">{formatNumber(row.aiCalls)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
