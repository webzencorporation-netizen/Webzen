'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, Power, PowerOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UsageMeter } from '@/components/charts/daily-bars';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { companyStatusLabels, featureLabels, integrationStatusLabels, roleLabels, templateLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { UsageStatus } from '../types';
import { STATUS_TONE } from './companies-page';

interface CompanyDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  templateKey: string;
  timezone: string;
  phone: string | null;
  createdAt: string;
  suspendedReason: string | null;
  subscription: { plan: { key: string; name: string } } | null;
  whatsappAccounts: { id: string; phoneNumberId: string; displayPhoneNumber: string | null; verifiedName: string | null; status: string; lastError: string | null; lastWebhookAt: string | null }[];
  aiConfiguration: { enabled: boolean; model: string | null; messageBufferSeconds: number } | null;
  featureFlags: { flag: string; enabled: boolean }[];
  members: { id: string; role: string; isActive: boolean; user: { email: string; name: string } }[];
  usage: UsageStatus;
  recentErrors: { id: string; source: string; code: string; message: string; createdAt: string }[];
  conversationsTotal: number;
}

export function PlatformCompanyPage({ companyId }: { companyId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const detail = useQuery({ queryKey: ['platform-company', companyId], queryFn: () => api.get<CompanyDetail>(`/platform/companies/${companyId}`) });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<{ key: string; name: string }[]>('/platform/plans') });
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportReason, setSupportReason] = useState('');
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const refresh = () => void client.invalidateQueries({ queryKey: ['platform-company', companyId] });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const setStatus = useMutation({ mutationFn: (status: string) => api.post(`/platform/companies/${companyId}/status`, { status }), onSuccess: refresh, onError });
  const setAgent = useMutation({ mutationFn: (suspended: boolean) => api.post(`/platform/companies/${companyId}/agent`, { suspended }), onSuccess: refresh, onError });
  const setPlan = useMutation({ mutationFn: (planKey: string) => api.put(`/platform/companies/${companyId}/plan`, { planKey }), onSuccess: () => { refresh(); toast.success('Plano alterado.'); }, onError });
  const setFlag = useMutation({ mutationFn: ({ flag, enabled }: { flag: string; enabled: boolean | null }) => api.put(`/platform/companies/${companyId}/feature-flags`, { flag, enabled }), onSuccess: refresh, onError });
  const saveLimits = useMutation({
    mutationFn: () => api.put(`/platform/companies/${companyId}/limits`, { limits: Object.entries(limitDrafts).map(([metric, value]) => ({ metric, limitValue: value === '' ? null : Number(value) })) }),
    onSuccess: () => { setLimitDrafts({}); refresh(); toast.success('Limites atualizados.'); },
    onError,
  });
  const applyTemplate = useMutation({ mutationFn: (templateKey: string) => api.post(`/platform/companies/${companyId}/template`, { templateKey, includeAgentDefaults: false }), onSuccess: () => { refresh(); toast.success('Template aplicado.'); }, onError });
  const support = useMutation({
    mutationFn: () => api.post(`/platform/companies/${companyId}/support`, { reason: supportReason }),
    onSuccess: () => { client.clear(); router.push('/app'); },
    onError,
  });

  if (!detail.data) return <PageContainer><Skeleton className="h-96" /></PageContainer>;
  const company = detail.data;
  const overrides = new Map(company.featureFlags.map((flag) => [flag.flag, flag.enabled]));

  return (
    <PageContainer>
      <PageHeader
        title={company.name}
        description={`${templateLabels[company.templateKey]} · criada em ${formatDateTime(company.createdAt)} · ${company.conversationsTotal} conversas`}
        actions={
          <>
            <Button variant="ghost" asChild><Link href="/platform"><ArrowLeft className="h-4 w-4" /> Empresas</Link></Button>
            <Button variant="secondary" onClick={() => setSupportOpen(true)}><LifeBuoy className="h-4 w-4" /> Modo suporte</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Status" />
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge tone={STATUS_TONE[company.status] ?? 'neutral'}>{companyStatusLabels[company.status]}</Badge>
              <div className="flex gap-2">
                {company.status !== 'ACTIVE' ? <Button size="sm" onClick={() => setStatus.mutate('ACTIVE')}>Ativar</Button> : null}
                {company.status !== 'SUSPENDED' ? <Button size="sm" variant="secondary" onClick={() => setStatus.mutate('SUSPENDED')}>Suspender</Button> : null}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm">Agente de IA: {company.aiConfiguration?.enabled ? <Badge tone="brand">Ativo</Badge> : <Badge>Pausado</Badge>}</span>
              {company.aiConfiguration?.enabled ? (
                <Button size="sm" variant="danger" onClick={() => setAgent.mutate(true)}><PowerOff className="h-4 w-4" /> Suspender agente</Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setAgent.mutate(false)}><Power className="h-4 w-4" /> Reativar agente</Button>
              )}
            </div>
            <Field label="Plano">
              {(id) => <Select id={id} value={company.subscription?.plan.key ?? ''} onChange={(event) => setPlan.mutate(event.target.value)}>{(plans.data ?? []).map((plan) => <option key={plan.key} value={plan.key}>{plan.name}</option>)}</Select>}
            </Field>
            <Field label="Aplicar template">
              {(id) => <Select id={id} value={company.templateKey} onChange={(event) => applyTemplate.mutate(event.target.value)}>{Object.entries(templateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Consumo e limites" description="Deixe vazio para usar o limite do plano." action={Object.keys(limitDrafts).length ? <Button size="sm" onClick={() => saveLimits.mutate()} loading={saveLimits.isPending}>Salvar</Button> : null} />
          <CardContent className="space-y-4">
            {company.usage.metrics.map((metric) => (
              <div key={metric.metric} className="space-y-1.5">
                <UsageMeter label={metric.label} current={metric.current} limit={metric.limit} state={metric.state} />
                <Input className="h-8 text-xs" type="number" min={0} placeholder={`Limite (atual: ${metric.limit ?? 'ilimitado'})`} value={limitDrafts[metric.metric] ?? ''} onChange={(event) => setLimitDrafts({ ...limitDrafts, [metric.metric]: event.target.value })} aria-label={`Novo limite ${metric.label}`} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Recursos" description="Sobrescreve o que o plano oferece." />
          <CardContent className="space-y-2">
            {Object.entries(featureLabels).map(([flag, label]) => (
              <div key={flag} className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <Select className="h-8 w-40 text-xs" value={overrides.has(flag) ? String(overrides.get(flag)) : ''} onChange={(event) => setFlag.mutate({ flag, enabled: event.target.value === '' ? null : event.target.value === 'true' })} aria-label={label}>
                  <option value="">Conforme plano</option>
                  <option value="true">Liberado</option>
                  <option value="false">Bloqueado</option>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="WhatsApp" />
          <Table>
            <thead><tr><Th>Número</Th><Th>Status</Th><Th>Último evento</Th><Th>Erro</Th></tr></thead>
            <tbody>
              {company.whatsappAccounts.map((account) => (
                <tr key={account.id}>
                  <Td>{account.displayPhoneNumber ?? account.phoneNumberId}<p className="text-xs text-muted">{account.verifiedName}</p></Td>
                  <Td><Badge tone={account.status === 'CONNECTED' ? 'brand' : account.status === 'ERROR' ? 'red' : 'neutral'}>{integrationStatusLabels[account.status]}</Badge></Td>
                  <Td className="text-muted">{formatDateTime(account.lastWebhookAt)}</Td>
                  <Td className="text-xs text-red-600">{account.lastError ?? ''}</Td>
                </tr>
              ))}
              {company.whatsappAccounts.length === 0 ? <tr><Td colSpan={4} className="text-muted">Nenhum número conectado.</Td></tr> : null}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Equipe" />
          <ul className="divide-y divide-border text-sm">
            {company.members.map((member) => (
              <li key={member.id} className="flex items-center justify-between px-5 py-2.5">
                <span><span className="font-medium">{member.user.name}</span><span className="block text-xs text-muted">{member.user.email}</span></span>
                <Badge>{roleLabels[member.role]}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Erros recentes" />
          <Table>
            <thead><tr><Th>Quando</Th><Th>Origem</Th><Th>Código</Th><Th>Mensagem</Th></tr></thead>
            <tbody>
              {company.recentErrors.map((error) => (
                <tr key={error.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(error.createdAt)}</Td>
                  <Td><Badge>{error.source}</Badge></Td>
                  <Td className="font-mono text-xs">{error.code}</Td>
                  <Td className="text-xs">{error.message}</Td>
                </tr>
              ))}
              {company.recentErrors.length === 0 ? <tr><Td colSpan={4} className="text-muted">Nenhum erro registrado.</Td></tr> : null}
            </tbody>
          </Table>
        </Card>
      </div>
      <Dialog
        open={supportOpen}
        onOpenChange={setSupportOpen}
        title="Entrar em modo suporte"
        description="Você acessará o painel desta empresa com permissões de administrador por 1 hora. Todas as ações são auditadas."
        footer={<Button onClick={() => support.mutate()} disabled={supportReason.length < 5} loading={support.isPending}>Entrar</Button>}
      >
        <Field label="Motivo (obrigatório)">{(id) => <Input id={id} value={supportReason} onChange={(event) => setSupportReason(event.target.value)} placeholder="Ex.: chamado #123 — configurar agente" />}</Field>
      </Dialog>
    </PageContainer>
  );
}
