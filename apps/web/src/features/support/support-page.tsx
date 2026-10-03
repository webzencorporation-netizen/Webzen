'use client';

import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, type TicketStatus } from '@botsaas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, Pagination, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useCan } from '@/lib/session';

export const TICKET_STATUS_TONES: Record<TicketStatus, BadgeTone> = {
  OPEN: 'blue',
  IN_PROGRESS: 'violet',
  WAITING_USER: 'amber',
  RESOLVED: 'brand',
  CLOSED: 'neutral',
};

interface TicketListItem {
  id: string;
  number: number;
  subject: string;
  category: keyof typeof TICKET_CATEGORY_LABELS;
  status: TicketStatus;
  lastMessageAt: string;
}

export function SupportPage() {
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'TECHNICAL', body: '' });
  const tickets = useQuery({ queryKey: ['tickets', page], queryFn: () => api.get<Paginated<TicketListItem>>('/app/support/tickets', { page, pageSize: 20 }) });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string; number: number }>('/app/support/tickets', form),
    onSuccess: (ticket) => {
      setOpening(false);
      setForm({ subject: '', category: 'TECHNICAL', body: '' });
      void client.invalidateQueries({ queryKey: ['tickets'] });
      toast.success(`Chamado #${ticket.number} aberto. Respondemos por aqui e por e-mail.`);
      router.push(`/app/support/${ticket.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Suporte"
        description="Fale com a equipe WebZen. Acompanhe as respostas aqui."
        actions={
          can('support:write') ? (
            <Button onClick={() => setOpening(true)}>
              <Plus className="h-4 w-4" /> Abrir chamado
            </Button>
          ) : null
        }
      />
      <Card>
        {tickets.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-32" />
          </div>
        ) : !tickets.data?.items.length ? (
          <EmptyState
            icon={LifeBuoy}
            title="Nenhum chamado aberto"
            description="Se algo não funcionar como esperado, abra um chamado e conte o que aconteceu."
            action={can('support:write') ? <Button onClick={() => setOpening(true)}>Abrir chamado</Button> : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {tickets.data.items.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={`/app/support/${ticket.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        <span className="text-muted">#{ticket.number}</span> {ticket.subject}
                      </p>
                      <p className="text-xs text-muted">
                        {TICKET_CATEGORY_LABELS[ticket.category]} · atualizado {formatRelative(ticket.lastMessageAt)}
                      </p>
                    </div>
                    <Badge tone={TICKET_STATUS_TONES[ticket.status]}>{TICKET_STATUS_LABELS[ticket.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={tickets.data.page} pageSize={tickets.data.pageSize} total={tickets.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
      <Dialog
        open={opening}
        onOpenChange={setOpening}
        title="Abrir chamado"
        size="lg"
        footer={
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.subject.trim().length < 4 || form.body.trim().length < 2}>
            Enviar chamado
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Assunto">{(id) => <Input id={id} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Ex.: o atendente não responde fora do horário" />}</Field>
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {TICKET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {TICKET_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="O que aconteceu?" hint="Conte o passo a passo e, se puder, o horário. Não envie senhas.">
            {(id) => <Textarea id={id} rows={6} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />}
          </Field>
        </div>
      </Dialog>
    </PageContainer>
  );
}
