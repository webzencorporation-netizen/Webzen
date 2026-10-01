'use client';

import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from '@botsaas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { TicketThread, type ThreadMessage } from '@/features/support/ticket-thread';
import { api, errorMessage } from '@/lib/api';

interface StaffTicket {
  id: string;
  number: number;
  subject: string;
  category: keyof typeof TICKET_CATEGORY_LABELS;
  status: TicketStatus;
  priority: TicketPriority;
  prioritySupport: boolean;
  company: { id: string; name: string };
  messages: ThreadMessage[];
}

export function PlatformTicketPage({ id }: { id: string }) {
  const toast = useToast();
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const ticket = useQuery({ queryKey: ['platform-ticket', id], queryFn: () => api.get<StaffTicket>(`/platform/support/tickets/${id}`) });
  const done = (data: StaffTicket) => {
    client.setQueryData(['platform-ticket', id], data);
    void client.invalidateQueries({ queryKey: ['platform-tickets'] });
  };
  const reply = useMutation({
    mutationFn: (internal: boolean) => api.post<StaffTicket>(`/platform/support/tickets/${id}/messages`, { body, internal }),
    onSuccess: (data, internal) => {
      setBody('');
      done(data);
      toast.success(internal ? 'Nota interna salva.' : 'Resposta enviada ao cliente.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = useMutation({
    mutationFn: (input: { status?: TicketStatus; priority?: TicketPriority; assignedToMe?: boolean }) => api.patch<StaffTicket>(`/platform/support/tickets/${id}`, input),
    onSuccess: done,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <PageContainer className="max-w-4xl">
      <Link href="/platform/support" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Chamados
      </Link>
      {!ticket.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              <span className="text-muted">#{ticket.data.number}</span> {ticket.data.subject}
            </h1>
            <p className="mb-6 mt-1 text-sm text-muted">
              <Link href={`/platform/companies/${ticket.data.company.id}`} className="text-brand-700 hover:underline">
                {ticket.data.company.name}
              </Link>{' '}
              · {TICKET_CATEGORY_LABELS[ticket.data.category]}
              {ticket.data.prioritySupport ? ' · suporte prioritário' : ''}
            </p>
            <TicketThread messages={ticket.data.messages} perspective="staff" />
            <Card className="mt-6">
              <CardContent className="space-y-3">
                <label htmlFor="staff-reply" className="text-sm font-medium text-slate-700">
                  Mensagem
                </label>
                <Textarea id="staff-reply" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => reply.mutate(true)} loading={reply.isPending && reply.variables === true} disabled={body.trim().length < 2}>
                    Salvar nota interna
                  </Button>
                  <Button onClick={() => reply.mutate(false)} loading={reply.isPending && reply.variables === false} disabled={body.trim().length < 2}>
                    Responder cliente
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="h-fit">
            <CardContent className="space-y-4">
              <Field label="Situação">
                {(fieldId) => (
                  <Select id={fieldId} value={ticket.data.status} onChange={(event) => update.mutate({ status: event.target.value as TicketStatus })}>
                    {TICKET_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {TICKET_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Prioridade">
                {(fieldId) => (
                  <Select id={fieldId} value={ticket.data.priority} onChange={(event) => update.mutate({ priority: event.target.value as TicketPriority })}>
                    {TICKET_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {TICKET_PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="secondary" className="w-full" onClick={() => update.mutate({ assignedToMe: true })}>
                Assumir chamado
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
