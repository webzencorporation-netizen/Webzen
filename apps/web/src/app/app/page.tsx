'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, CalendarCheck, Clock3, Handshake, MessageCircle, Sparkles, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DailyBars, UsageMeter, type DailyPoint } from '@/components/charts/daily-bars';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader, Skeleton, StatCard, Tabs } from '@/components/ui/misc';
import { SetupChecklist } from '@/features/dashboard/setup-checklist';
import type { ConversationListItem, UsageStatus } from '@/features/types';
import { usageStateLabels } from '@/i18n/pt-BR';
import { api, type Paginated } from '@/lib/api';
import { formatNumber, formatPhone, formatRelative } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

interface Overview {
  conversations: { today: number; month: number; period: number };
  newContacts: number;
  leads: { created: number; won: number };
  attendance: { ai: number; human: number; handoffs: number };
  appointments: number;
  messages: { sent: number; received: number };
  responseRate: number | null;
  avgFirstResponseSeconds: number | null;
  ai: { calls: number; costUsd: number };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'month'>('30d');
  const { data: me } = useMe();
  const can = useCan();
  const overview = useQuery({ queryKey: ['metrics', period], queryFn: () => api.get<Overview>('/app/metrics/overview', { period }), enabled: can('reports:read') });
  const series = useQuery({ queryKey: ['series'], queryFn: () => api.get<DailyPoint[]>('/app/metrics/series', { days: 30 }), enabled: can('reports:read') });
  const waiting = useQuery({
    queryKey: ['conversations', 'waiting-dashboard'],
    queryFn: () => api.get<Paginated<ConversationListItem>>('/app/conversations', { filter: 'waiting', pageSize: 5 }),
    enabled: can('conversations:read'),
  });
  const usage = useQuery({ queryKey: ['usage-status'], queryFn: () => api.get<UsageStatus>('/app/company/usage-status') });
  const data = overview.data;

  return (
    <PageContainer>
      <PageHeader
        title={me ? `Olá, ${me.user.name}` : 'Visão geral'}
        description="Resumo do atendimento da sua empresa."
        actions={
          <Tabs
            value={period}
            onValueChange={(value) => setPeriod(value as typeof period)}
            items={[
              { value: 'today', label: 'Hoje' },
              { value: '7d', label: '7 dias' },
              { value: '30d', label: '30 dias' },
              { value: 'month', label: 'Mês' },
            ]}
          />
        }
      />

      {can('settings:manage') ? <SetupChecklist /> : null}

      {can('reports:read') ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Conversas hoje" value={formatNumber(data?.conversations.today)} hint={`${formatNumber(data?.conversations.month)} no mês`} icon={MessageCircle} loading={overview.isLoading} />
          <StatCard label="Novos contatos" value={formatNumber(data?.newContacts)} hint={`${formatNumber(data?.leads.created)} leads · ${formatNumber(data?.leads.won)} fechados`} icon={UserPlus} loading={overview.isLoading} />
          <StatCard label="Atendidas pela IA" value={formatNumber(data?.attendance.ai)} hint={`${formatNumber(data?.attendance.human)} com a equipe · ${formatNumber(data?.attendance.handoffs)} encaminhamentos`} icon={Bot} loading={overview.isLoading} />
          <StatCard label="Agendamentos" value={formatNumber(data?.appointments)} hint="criados no período" icon={CalendarCheck} loading={overview.isLoading} />
          <StatCard label="Taxa de resposta" value={data?.responseRate !== null && data?.responseRate !== undefined ? `${data.responseRate}%` : '—'} icon={Handshake} loading={overview.isLoading} />
          <StatCard label="1ª resposta (média)" value={formatDuration(data?.avgFirstResponseSeconds ?? null)} icon={Clock3} loading={overview.isLoading} />
          <StatCard label="Mensagens enviadas" value={formatNumber(data?.messages.sent)} hint={`${formatNumber(data?.messages.received)} recebidas`} icon={Users} loading={overview.isLoading} />
          <StatCard label="Atendimentos da IA" value={formatNumber(data?.ai.calls)} hint="consumo detalhado em Métricas" icon={Sparkles} loading={overview.isLoading} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {can('reports:read') ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Movimento dos últimos 30 dias" description="Mensagens recebidas de clientes e respostas enviadas (IA + equipe)." />
            <CardContent>
              {series.isLoading ? <Skeleton className="h-44" /> : series.data && series.data.length > 0 ? <DailyBars data={series.data} /> : <EmptyState title="Sem movimento ainda" description="Os dados aparecem assim que as conversas começarem." />}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Consumo do plano"
            action={usage.data ? <Badge tone={usage.data.state === 'NORMAL' ? 'brand' : usage.data.state === 'WARNING' ? 'amber' : 'red'}>{usageStateLabels[usage.data.state]}</Badge> : null}
          />
          <CardContent className="space-y-4">
            {usage.isLoading ? <Skeleton className="h-32" /> : usage.data?.metrics.map((metric) => <UsageMeter key={metric.metric} label={metric.label} current={metric.current} limit={metric.limit} state={metric.state} />)}
          </CardContent>
        </Card>

        {can('conversations:read') ? (
          <Card className="lg:col-span-3">
            <CardHeader
              title="Aguardando a equipe"
              description="Conversas que a IA encaminhou para atendimento humano."
              action={
                <Link href="/app/conversations?filter=waiting" className="text-sm font-medium text-brand-700 hover:underline">
                  Ver fila
                </Link>
              }
            />
            {waiting.data && waiting.data.items.length > 0 ? (
              <ul className="divide-y divide-border">
                {waiting.data.items.map((conversation) => (
                  <li key={conversation.id}>
                    <Link href={`/app/conversations/${conversation.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{conversation.contact.name ?? formatPhone(conversation.contact.phone)}</p>
                        <p className="truncate text-xs text-muted">{conversation.attentionReason ?? conversation.lastMessagePreview}</p>
                      </div>
                      <span className="text-xs text-muted">{formatRelative(conversation.lastMessageAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Ninguém aguardando" description="Quando a IA precisar de ajuda, as conversas aparecem aqui." />
            )}
          </Card>
        ) : null}
      </div>
    </PageContainer>
  );
}
