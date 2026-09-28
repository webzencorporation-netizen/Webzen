'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader, Skeleton, StatCard, Table, Tabs, Td, Th } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatNumber, formatUsd } from '@/lib/format';

type Period = 'today' | '7d' | '30d' | 'month';
interface Summary { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; conversations: number; avgCostPerConversationUsd: number }

export function PlatformUsagePage() {
  const [period, setPeriod] = useState<Period>('30d');
  const usage = useQuery({
    queryKey: ['platform-usage', period],
    queryFn: () => api.get<{ periods: Record<Period, Summary>; byCompany: { companyId: string; companyName: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }[] }>('/platform/usage', { period }),
  });
  const summary = usage.data?.periods[period];
  return (
    <PageContainer>
      <PageHeader title="Uso da plataforma" description="Consumo de IA consolidado (inclui testes)." actions={<Tabs value={period} onValueChange={(value) => setPeriod(value as Period)} items={[{ value: 'today', label: 'Hoje' }, { value: '7d', label: '7 dias' }, { value: '30d', label: '30 dias' }, { value: 'month', label: 'Mês' }]} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Chamadas" value={formatNumber(summary?.calls)} loading={usage.isLoading} />
        <StatCard label="Tokens (entrada/saída)" value={`${formatNumber(summary?.inputTokens)} / ${formatNumber(summary?.outputTokens)}`} loading={usage.isLoading} />
        <StatCard label="Cache lido" value={formatNumber(summary?.cacheReadTokens)} loading={usage.isLoading} />
        <StatCard label="Custo estimado" value={formatUsd(summary?.costUsd)} hint={`média ${formatUsd(summary?.avgCostPerConversationUsd)} por conversa`} loading={usage.isLoading} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Custo por empresa" />
        {!usage.data ? <Skeleton className="m-4 h-40" /> : (
          <Table>
            <thead><tr><Th>Empresa</Th><Th className="text-right">Chamadas</Th><Th className="text-right">Tokens entrada</Th><Th className="text-right">Tokens saída</Th><Th className="text-right">Custo</Th></tr></thead>
            <tbody>
              {usage.data.byCompany.map((row) => (
                <tr key={row.companyId}>
                  <Td><Link href={`/platform/companies/${row.companyId}`} className="font-medium hover:underline">{row.companyName}</Link></Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.calls)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.inputTokens)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.outputTokens)}</Td>
                  <Td className="text-right tabular-nums">{formatUsd(row.costUsd)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
