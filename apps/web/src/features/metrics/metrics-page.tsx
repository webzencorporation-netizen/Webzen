'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { UsageMeter } from '@/components/charts/daily-bars';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageHeader, Pagination, Skeleton, StatCard, Table, Tabs, Td, Th } from '@/components/ui/misc';
import { api, type Paginated } from '@/lib/api';
import { formatDateTime, formatNumber, formatUsd } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { UsageStatus } from '../types';

interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  conversations: number;
  avgCostPerConversationUsd: number;
}
type Period = 'today' | '7d' | '30d' | 'month';
const PERIOD_LABELS: Record<Period, string> = { today: 'Hoje', '7d': '7 dias', '30d': '30 dias', month: 'Mês' };

interface AgentRunRow {
  id: string;
  conversationId: string | null;
  trigger: string;
  status: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  iterations: number;
  durationMs: number | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
  startedAt: string;
  toolCalls: { name: string; ok: boolean }[] | null;
}

export function MetricsPage() {
  const can = useCan();
  const [period, setPeriod] = useState<Period>('30d');
  const [runsPage, setRunsPage] = useState(1);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const usage = useQuery({
    queryKey: ['usage', period],
    queryFn: () => api.get<{ periods: Record<Period, UsageSummary>; topConversations: { conversationId: string; calls: number; costUsd: number }[]; limits: UsageStatus }>('/app/metrics/usage', { period }),
    enabled: can('usage:read'),
  });
  const runs = useQuery({
    queryKey: ['agent-runs', runsPage, onlyFailures],
    queryFn: () => api.get<Paginated<AgentRunRow>>('/app/ai/runs', { page: runsPage, pageSize: 15, status: onlyFailures ? 'FAILED' : undefined }),
    enabled: can('ai:read'),
  });
  const current = usage.data?.periods[period];

  return (
    <PageContainer>
      <PageHeader
        title="Métricas e consumo da IA"
        description="Uso do atendente virtual, custos estimados e limites do plano."
        actions={
          <>
            <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)} items={(Object.keys(PERIOD_LABELS) as Period[]).map((value) => ({ value, label: PERIOD_LABELS[value] }))} />
            {can('usage:read') ? <Button variant="secondary" asChild><a href="/api/app/exports/usage.csv"><Download className="h-4 w-4" /> Exportar</a></Button> : null}
          </>
        }
      />
      {can('usage:read') ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Atendimentos da IA" value={formatNumber(current?.calls)} loading={usage.isLoading} />
            <StatCard label="Conversas atendidas" value={formatNumber(current?.conversations)} loading={usage.isLoading} />
            <StatCard label="Custo estimado" value={formatUsd(current?.costUsd)} hint="Estimativa com base na tabela de preços vigente" loading={usage.isLoading} />
            <StatCard label="Custo médio por conversa" value={formatUsd(current?.avgCostPerConversationUsd)} loading={usage.isLoading} />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Detalhes técnicos por período" description="Tokens processados pelo modelo (entrada, saída e cache)." />
              {usage.isLoading || !usage.data ? <div className="p-4"><Skeleton className="h-32" /></div> : (
                <Table>
                  <thead><tr><Th>Período</Th><Th className="text-right">Chamadas</Th><Th className="text-right">Entrada</Th><Th className="text-right">Saída</Th><Th className="text-right">Cache (leitura)</Th><Th className="text-right">Custo</Th></tr></thead>
                  <tbody>
                    {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => {
                      const row = usage.data.periods[key];
                      return (
                        <tr key={key} className={key === period ? 'bg-brand-50/50' : ''}>
                          <Td className="font-medium">{PERIOD_LABELS[key]}</Td>
                          <Td className="text-right tabular-nums">{formatNumber(row.calls)}</Td>
                          <Td className="text-right tabular-nums">{formatNumber(row.inputTokens)}</Td>
                          <Td className="text-right tabular-nums">{formatNumber(row.outputTokens)}</Td>
                          <Td className="text-right tabular-nums">{formatNumber(row.cacheReadTokens)}</Td>
                          <Td className="text-right tabular-nums">{formatUsd(row.costUsd)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="Limites do plano" />
              <CardContent className="space-y-4">
                {usage.data?.limits.metrics.map((metric) => <UsageMeter key={metric.metric} label={metric.label} current={metric.current} limit={metric.limit} state={metric.state} />)}
              </CardContent>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader title="Conversas com maior custo no período" />
              <ul className="divide-y divide-border">
                {(usage.data?.topConversations ?? []).map((row) => (
                  <li key={row.conversationId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/app/conversations/${row.conversationId}`} className="font-mono text-xs text-brand-700 hover:underline">{row.conversationId?.slice(0, 8)}…</Link>
                    <span className="text-muted">{row.calls} chamadas · {formatUsd(row.costUsd)}</span>
                  </li>
                ))}
                {usage.data?.topConversations.length === 0 ? <li className="px-5 py-4 text-sm text-muted">Sem dados no período.</li> : null}
              </ul>
            </Card>
          </div>
        </>
      ) : null}
      {can('ai:read') ? (
        <Card className="mt-6">
          <CardHeader
            title="Execuções do agente"
            description="Registro operacional de cada resposta da IA (sem conteúdo de raciocínio)."
            action={<Button size="sm" variant={onlyFailures ? 'primary' : 'secondary'} onClick={() => { setOnlyFailures(!onlyFailures); setRunsPage(1); }}>Somente falhas</Button>}
          />
          {runs.isLoading || !runs.data ? <div className="p-4"><Skeleton className="h-40" /></div> : (
            <>
              <Table>
                <thead><tr><Th>Quando</Th><Th>Status</Th><Th>Modelo</Th><Th>Ferramentas</Th><Th className="text-right">Tokens</Th><Th className="text-right">Duração</Th><Th className="text-right">Custo</Th></tr></thead>
                <tbody>
                  {runs.data.items.map((run) => (
                    <tr key={run.id}>
                      <Td>{run.conversationId ? <Link href={`/app/conversations/${run.conversationId}`} className="hover:underline">{formatDateTime(run.startedAt)}</Link> : formatDateTime(run.startedAt)}</Td>
                      <Td>{run.status === 'SUCCEEDED' ? <Badge tone="brand">OK</Badge> : run.status === 'FAILED' ? <Badge tone="red">{run.errorCode ?? 'Falhou'}</Badge> : <Badge>{run.status}</Badge>}</Td>
                      <Td className="font-mono text-xs">{run.model}</Td>
                      <Td className="text-xs">{(run.toolCalls ?? []).map((call) => call.name).join(', ') || '—'}</Td>
                      <Td className="text-right tabular-nums">{formatNumber(run.inputTokens + run.outputTokens)}</Td>
                      <Td className="text-right tabular-nums">{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</Td>
                      <Td className="text-right tabular-nums">{formatUsd(run.estimatedCostUsd)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={runs.data.page} pageSize={runs.data.pageSize} total={runs.data.total} onPageChange={setRunsPage} />
            </>
          )}
        </Card>
      ) : null}
    </PageContainer>
  );
}
