'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader, Pagination, Skeleton, Table, Tabs, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCanPlatform } from '@/lib/session';

interface BillingEvent {
  id: string;
  type: string;
  status: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';
  livemode: boolean;
  objectId: string | null;
  attempts: number;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  company: { id: string; name: string } | null;
}

const STATUS: Record<BillingEvent['status'], { label: string; tone: BadgeTone }> = {
  PROCESSED: { label: 'Processado', tone: 'brand' },
  RECEIVED: { label: 'Na fila', tone: 'blue' },
  IGNORED: { label: 'Ignorado', tone: 'neutral' },
  FAILED: { label: 'Falhou', tone: 'red' },
};

/** Eventos do gateway de cobrança: acompanhamento e reprocessamento dos que falharam. */
export function PlatformBillingPage() {
  const toast = useToast();
  const client = useQueryClient();
  const can = useCanPlatform();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: ['platform-billing-events', status, page],
    queryFn: () => api.get<Paginated<BillingEvent>>('/platform/billing/events', { status: status || undefined, page, pageSize: 25 }),
  });
  const replay = useMutation({
    mutationFn: (id: string) => api.post(`/platform/billing/events/${id}/replay`),
    onSuccess: () => {
      toast.success('Evento enviado para reprocessamento.');
      void client.invalidateQueries({ queryKey: ['platform-billing-events'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <PageContainer>
      <PageHeader title="Cobrança" description="Eventos recebidos do gateway de pagamento. O processamento relê cada objeto no gateway, então reprocessar é seguro." />
      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        items={[
          { value: '', label: 'Todos' },
          { value: 'FAILED', label: 'Com falha' },
          { value: 'RECEIVED', label: 'Na fila' },
          { value: 'PROCESSED', label: 'Processados' },
          { value: 'IGNORED', label: 'Ignorados' },
        ]}
        className="mb-4"
      />
      <Card>
        {events.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-48" />
          </div>
        ) : !events.data?.items.length ? (
          <EmptyState icon={Receipt} title="Nenhum evento" description="Os eventos aparecem aqui quando o gateway envia webhooks." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Recebido</Th>
                  <Th>Evento</Th>
                  <Th>Empresa</Th>
                  <Th>Situação</Th>
                  <Th>Tentativas</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {events.data.items.map((event) => (
                  <tr key={event.id}>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(event.receivedAt)}</Td>
                    <Td>
                      <p className="font-mono text-xs">{event.type}</p>
                      <p className="font-mono text-[11px] text-muted">
                        {event.objectId}
                        {event.livemode ? ' · produção' : ' · teste'}
                      </p>
                      {event.error ? <p className="mt-1 max-w-md text-xs text-red-700">{event.error}</p> : null}
                    </Td>
                    <Td>{event.company ? <Link href={`/platform/companies/${event.company.id}`} className="text-brand-700 hover:underline">{event.company.name}</Link> : <span className="text-muted">—</span>}</Td>
                    <Td>
                      <Badge tone={STATUS[event.status].tone}>{STATUS[event.status].label}</Badge>
                    </Td>
                    <Td className="tabular-nums">{event.attempts}</Td>
                    <Td className="text-right">
                      {can('platform:companies:write') && (event.status === 'FAILED' || event.status === 'RECEIVED') ? (
                        <Button size="sm" variant="secondary" onClick={() => replay.mutate(event.id)} loading={replay.isPending && replay.variables === event.id}>
                          <RotateCw className="h-4 w-4" /> Reprocessar
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={events.data.page} pageSize={events.data.pageSize} total={events.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
