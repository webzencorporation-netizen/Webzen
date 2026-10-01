'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, PageHeader, Pagination, Skeleton, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { companyStatusLabels, integrationStatusLabels, templateLabels } from '@/i18n/pt-BR';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatNumber, formatUsd } from '@/lib/format';

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  templateKey: string;
  plan: { key: string; name: string } | null;
  aiEnabled: boolean;
  whatsapp: string;
  members: number;
  conversations30d: number;
  aiCost30dUsd: number;
  errors24h: number;
}

export const STATUS_TONE: Record<string, BadgeTone> = { ACTIVE: 'brand', ONBOARDING: 'blue', SUSPENDED: 'amber', CANCELLED: 'red' };

function NewCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<{ key: string; name: string }[]>('/platform/plans'), enabled: open });
  const [form, setForm] = useState({ name: '', templateKey: 'CLINIC', timezone: 'America/Sao_Paulo', planKey: '', phone: '', ownerName: '', ownerEmail: '' });
  const [result, setResult] = useState<{ id: string; password: string | null } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<{ company: { id: string }; ownerTemporaryPassword: string | null }>('/platform/companies', {
        name: form.name,
        templateKey: form.templateKey,
        timezone: form.timezone,
        planKey: form.planKey || null,
        phone: form.phone || null,
        owner: { name: form.ownerName, email: form.ownerEmail },
      }),
    onSuccess: (data) => { void client.invalidateQueries({ queryKey: ['platform-companies'] }); setResult({ id: data.company.id, password: data.ownerTemporaryPassword }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const close = (value: boolean) => { onOpenChange(value); if (!value) setResult(null); };

  return (
    <Dialog open={open} onOpenChange={close} title={result ? 'Empresa criada' : 'Nova empresa'} size="lg" footer={result ? <Button asChild><Link href={`/platform/companies/${result.id}`}>Abrir empresa</Link></Button> : <Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.name.length < 2 || !form.ownerEmail || form.ownerName.length < 2}>Criar empresa</Button>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <p>A empresa foi criada com o template, funil, campos e ferramentas do segmento. Próximo passo: preencher dados, conectar o WhatsApp, testar e ativar.</p>
          {result.password ? (
            <div>
              <p className="mb-1 font-medium">Senha temporária do responsável (exibida uma única vez):</p>
              <code className="block rounded-lg bg-ink px-3 py-2 text-center font-mono text-lg text-white">{result.password}</code>
            </div>
          ) : <p className="text-muted">O e-mail do responsável já tinha acesso à plataforma e foi vinculado à nova empresa.</p>}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome da empresa" className="md:col-span-2">{(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
          <Field label="Segmento (template)">{(id) => <Select id={id} value={form.templateKey} onChange={(event) => setForm({ ...form, templateKey: event.target.value })}>{Object.entries(templateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}</Field>
          <Field label="Plano">{(id) => <Select id={id} value={form.planKey} onChange={(event) => setForm({ ...form, planKey: event.target.value })}><option value="">Plano de entrada</option>{(plans.data ?? []).map((plan) => <option key={plan.key} value={plan.key}>{plan.name}</option>)}</Select>}</Field>
          <Field label="Fuso horário">{(id) => <Input id={id} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />}</Field>
          <Field label="Telefone">{(id) => <Input id={id} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}</Field>
          <Field label="Nome do responsável">{(id) => <Input id={id} value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />}</Field>
          <Field label="E-mail do responsável">{(id) => <Input id={id} type="email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} />}</Field>
        </div>
      )}
    </Dialog>
  );
}

export function PlatformCompaniesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const companies = useQuery({ queryKey: ['platform-companies', search, status, page], queryFn: () => api.get<Paginated<CompanyRow>>('/platform/companies', { search, status, page, pageSize: 20 }) });

  return (
    <PageContainer>
      <PageHeader title="Empresas" description="Clientes da plataforma, status e consumo." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova empresa</Button>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar empresa" className="pl-9" aria-label="Buscar empresa" />
          </div>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="sm:w-48" aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(companyStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </div>
        {companies.isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !companies.data?.items.length ? <EmptyState icon={Building2} title="Nenhuma empresa" /> : (
          <>
            <Table>
              <thead><tr><Th>Empresa</Th><Th>Status</Th><Th>Plano</Th><Th>WhatsApp</Th><Th>IA</Th><Th className="text-right">Conversas 30d</Th><Th className="text-right">Custo IA 30d</Th><Th className="text-right">Erros 24h</Th></tr></thead>
              <tbody>
                {companies.data.items.map((company) => (
                  <tr key={company.id} className="hover:bg-slate-50">
                    <Td><Link href={`/platform/companies/${company.id}`} className="font-medium text-slate-900 hover:underline">{company.name}</Link><p className="text-xs text-muted">{templateLabels[company.templateKey]} · {company.members} usuários</p></Td>
                    <Td><Badge tone={STATUS_TONE[company.status] ?? 'neutral'}>{companyStatusLabels[company.status]}</Badge></Td>
                    <Td>{company.plan?.name ?? '—'}</Td>
                    <Td><Badge tone={company.whatsapp === 'CONNECTED' ? 'brand' : company.whatsapp === 'ERROR' ? 'red' : 'neutral'}>{integrationStatusLabels[company.whatsapp] ?? company.whatsapp}</Badge></Td>
                    <Td>{company.aiEnabled ? <Badge tone="brand">Ativa</Badge> : <Badge>Pausada</Badge>}</Td>
                    <Td className="text-right tabular-nums">{formatNumber(company.conversations30d)}</Td>
                    <Td className="text-right tabular-nums">{formatUsd(company.aiCost30dUsd)}</Td>
                    <Td className="text-right">{company.errors24h > 0 ? <Badge tone="red">{company.errors24h}</Badge> : '0'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={companies.data.page} pageSize={companies.data.pageSize} total={companies.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
      <NewCompanyDialog open={creating} onOpenChange={setCreating} />
    </PageContainer>
  );
}
