'use client';

import { TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, type TicketStatus } from '@botsaas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import { TICKET_STATUS_TONES } from './support-page';
import { TicketThread, type ThreadMessage } from './ticket-thread';

interface Ticket {
  id: string;
  number: number;
  subject: string;
  category: keyof typeof TICKET_CATEGORY_LABELS;
  status: TicketStatus;
  messages: ThreadMessage[];
}

export function TicketPage({ id }: { id: string }) {
  const can = useCan();
  const toast = useToast();
  const client = useQueryClient();
  const [reply, setReply] = useState('');
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<Ticket>(`/app/support/tickets/${id}`), refetchInterval: 30_000 });
  const update = (data: Ticket) => {
    client.setQueryData(['ticket', id], data);
    void client.invalidateQueries({ queryKey: ['tickets'] });
  };
  const send = useMutation({
    mutationFn: () => api.post<Ticket>(`/app/support/tickets/${id}/messages`, { body: reply }),
    onSuccess: (data) => {
      setReply('');
      update(data);
      toast.success('Resposta enviada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const close = useMutation({ mutationFn: () => api.post<Ticket>(`/app/support/tickets/${id}/close`), onSuccess: update, onError: (error) => toast.error(errorMessage(error)) });
  const reopen = useMutation({ mutationFn: () => api.post<Ticket>(`/app/support/tickets/${id}/reopen`), onSuccess: update, onError: (error) => toast.error(errorMessage(error)) });

  return (
    <PageContainer className="max-w-3xl">
      <Link href="/app/support" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Chamados
      </Link>
      {!ticket.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                <span className="text-muted">#{ticket.data.number}</span> {ticket.data.subject}
              </h1>
              <p className="mt-1 text-sm text-muted">{TICKET_CATEGORY_LABELS[ticket.data.category]}</p>
            </div>
            <Badge tone={TICKET_STATUS_TONES[ticket.data.status]}>{TICKET_STATUS_LABELS[ticket.data.status]}</Badge>
          </div>
          <TicketThread messages={ticket.data.messages} perspective="customer" />
          {can('support:write') ? (
            <Card className="mt-6">
              <CardContent className="space-y-3">
                {ticket.data.status === 'CLOSED' || ticket.data.status === 'RESOLVED' ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted">Chamado {ticket.data.status === 'CLOSED' ? 'encerrado' : 'resolvido'}. O problema voltou?</p>
                    <Button variant="secondary" onClick={() => reopen.mutate()} loading={reopen.isPending}>
                      Reabrir chamado
                    </Button>
                  </div>
                ) : (
                  <>
                    <label htmlFor="ticket-reply" className="text-sm font-medium text-slate-700">
                      Responder
                    </label>
                    <Textarea id="ticket-reply" rows={4} value={reply} onChange={(event) => setReply(event.target.value)} />
                    <div className="flex flex-wrap justify-between gap-2">
                      <Button variant="ghost" onClick={() => close.mutate()} loading={close.isPending}>
                        Encerrar chamado
                      </Button>
                      <Button onClick={() => send.mutate()} loading={send.isPending} disabled={reply.trim().length < 2}>
                        Enviar resposta
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
