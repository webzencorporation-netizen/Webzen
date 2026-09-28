'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { EmptyState, PageHeader, Pagination, Skeleton, Table, Td, Th } from '@/components/ui/misc';
import { api, type Paginated } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface ErrorRow { id: string; source: string; code: string; message: string; companyId: string | null; conversationId: string | null; jobId: string | null; createdAt: string; company: { name: string } | null }

export function PlatformErrorsPage() {
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const errors = useQuery({ queryKey: ['platform-errors', source, page], queryFn: () => api.get<Paginated<ErrorRow>>('/platform/errors', { source, page, pageSize: 25 }) });
  return (
    <PageContainer>
      <PageHeader
        title="Erros recentes"
        description="Falhas de IA, WhatsApp, webhooks, jobs e integrações."
        actions={
          <Select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} className="w-48" aria-label="Origem">
            <option value="">Todas as origens</option>
            {['AI', 'WHATSAPP', 'WEBHOOK', 'WORKER', 'INTEGRATION', 'API'].map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        }
      />
      <Card>
        {errors.isLoading ? <Skeleton className="m-4 h-40" /> : !errors.data?.items.length ? <EmptyState title="Nenhum erro registrado" /> : (
          <>
            <Table>
              <thead><tr><Th>Quando</Th><Th>Empresa</Th><Th>Origem</Th><Th>Código</Th><Th>Mensagem</Th></tr></thead>
              <tbody>
                {errors.data.items.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(row.createdAt)}</Td>
                    <Td>{row.companyId ? <Link href={`/platform/companies/${row.companyId}`} className="hover:underline">{row.company?.name ?? row.companyId.slice(0, 8)}</Link> : '—'}</Td>
                    <Td><Badge tone="red">{row.source}</Badge></Td>
                    <Td className="font-mono text-xs">{row.code}</Td>
                    <Td className="max-w-md text-xs">{row.message}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={errors.data.page} pageSize={errors.data.pageSize} total={errors.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </PageContainer>
  );
}
