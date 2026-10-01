'use client';

import {
  FEEDBACK_CATEGORY_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type FeedbackCategory,
  type TicketPriority,
  type TicketStatus,
} from '@botsaas/shared';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, MessageSquareHeart } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { EmptyState, PageHeader, Pagination, Skeleton, Tabs } from '@/components/ui/misc';
import { TICKET_STATUS_TONES } from '@/features/support/support-page';
import { api, type Paginated } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';

interface StaffTicket {
  id: string;
  number: number;
  subject: string;
  category: keyof typeof TICKET_CATEGORY_LABELS;
  status: TicketStatus;
  priority: TicketPriority;
  prioritySupport: boolean;
  lastMessageAt: string;
  company: { id: string; name: string };
}

interface FeedbackItem {
  id: string;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  createdAt: string;
  company: { id: string; name: string };
}

function FeedbackList() {
  const [page, setPage] = useState(1);
  const feedback = useQuery({ queryKey: ['platform-feedback', page], queryFn: () => api.get<Paginated<FeedbackItem>>('/platform/support/feedback', { page, pageSize: 20 }) });
  if (feedback.isLoading) return <Skeleton className="h-48" />;
  if (!feedback.data?.items.length) return <EmptyState icon={MessageSquareHeart} title="Nenhum feedback ainda" />;
  return (
    <>
      <ul className="divide-y divide-border">
        {feedback.data.items.map((item) => (
          <li key={item.id} className="px-5 py-4">
            <p className="text-xs text-muted">
              {FEEDBACK_CATEGORY_LABELS[item.category]} · {item.company.name} · {formatDateTime(item.createdAt)}
              {item.page ? ` · ${item.page}` : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.message}</p>
          </li>
        ))}
      </ul>
      <Pagination page={feedback.data.page} pageSize={feedback.data.pageSize} total={feedback.data.total} onPageChange={setPage} />
    </>
  );
}

export function PlatformSupportPage() {
  const [tab, setTab] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const status = tab === 'open' ? undefined : tab;
  const tickets = useQuery({
    queryKey: ['platform-tickets', tab, search, page],
    queryFn: () => api.get<Paginated<StaffTicket>>('/platform/support/tickets', { status, search: search || undefined, page, pageSize: 25 }),
    enabled: tab !== 'feedback',
  });
  return (
    <PageContainer>
      <PageHeader title="Suporte" description="Chamados das empresas. Planos com suporte prioritário aparecem primeiro." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setPage(1);
          }}
          items={[
            { value: 'open', label: 'Na fila' },
            { value: 'WAITING_USER', label: 'Aguardando cliente' },
            { value: 'RESOLVED', label: 'Resolvidos' },
            { value: 'CLOSED', label: 'Encerrados' },
            { value: 'feedback', label: 'Feedback' },
          ]}
        />
        {tab !== 'feedback' ? <Input className="w-64" placeholder="Buscar assunto ou número" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar chamados" /> : null}
      </div>
      <Card>
        {tab === 'feedback' ? (
          <FeedbackList />
        ) : tickets.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-48" />
          </div>
        ) : !tickets.data?.items.length ? (
          <EmptyState icon={LifeBuoy} title="Nenhum chamado aqui" />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {tickets.data.items.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={`/platform/support/${ticket.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        <span className="text-muted">#{ticket.number}</span> {ticket.subject}
                      </p>
                      <p className="text-xs text-muted">
                        {ticket.company.name} · {TICKET_CATEGORY_LABELS[ticket.category]} · {formatRelative(ticket.lastMessageAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {ticket.prioritySupport ? <Badge tone="violet">Prioritário</Badge> : null}
                      <Badge tone={ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'red' : 'neutral'}>{TICKET_PRIORITY_LABELS[ticket.priority]}</Badge>
                      <Badge tone={TICKET_STATUS_TONES[ticket.status]}>{TICKET_STATUS_LABELS[ticket.status]}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={tickets.data.page} pageSize={tickets.data.pageSize} total={tickets.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
