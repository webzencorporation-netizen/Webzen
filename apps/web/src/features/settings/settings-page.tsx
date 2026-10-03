'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader, Pagination, Skeleton, Table, Tabs, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { templateLabels } from '@/i18n/pt-BR';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { BusinessHoursEditor } from './business-hours-editor';
import { CompanyProfileForm } from './company-profile-form';
import { CrmSettings } from './crm-settings';
import { SettingsNav } from './settings-nav';
import type { CompanyProfile } from './types';

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  actorLabel: string | null;
  actorType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const audit = useQuery({ queryKey: ['audit', page], queryFn: () => api.get<Paginated<AuditEntry>>('/app/audit', { page, pageSize: 20 }) });
  if (!audit.data) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardHeader title="Registro de auditoria" description="Ações administrativas importantes realizadas na empresa." />
      <Table>
        <thead><tr><Th>Quando</Th><Th>Quem</Th><Th>Ação</Th><Th>Recurso</Th></tr></thead>
        <tbody>
          {audit.data.items.map((entry) => (
            <tr key={entry.id}>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(entry.createdAt)}</Td>
              <Td>{entry.actorLabel ?? entry.actorType}{entry.metadata?.supportMode ? ' (suporte)' : ''}</Td>
              <Td className="font-mono text-xs">{entry.action}</Td>
              <Td className="text-xs text-muted">{entry.resourceType}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={audit.data.page} pageSize={audit.data.pageSize} total={audit.data.total} onPageChange={setPage} />
    </Card>
  );
}

function PrivacySettings({ profile, editable }: { profile: CompanyProfile; editable: boolean }) {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [days, setDays] = useState(profile.messageRetentionDays?.toString() ?? '');
  const save = useMutation({
    mutationFn: () => api.patch('/app/company', { messageRetentionDays: days ? Number(days) : null }),
    onSuccess: () => { toast.success('Política de retenção salva.'); void client.invalidateQueries({ queryKey: ['company'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Retenção de mensagens" description="Mensagens e mídias mais antigas que o prazo são apagadas automaticamente." />
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <Field label="Prazo (dias)" hint="Vazio = manter indefinidamente. Mínimo 30 dias.">{(id) => <Input id={id} type="number" min={30} value={days} disabled={!editable} onChange={(event) => setDays(event.target.value)} className="w-40" />}</Field>
            {editable ? <Button onClick={() => save.mutate()} loading={save.isPending}>Salvar</Button> : null}
          </div>
          <p className="text-xs text-muted">
            As regras de retenção, bases legais e consentimento devem ser definidas pela sua empresa (controladora dos dados), com orientação jurídica própria. A plataforma oferece as ferramentas: exportação, exclusão de contatos e conversas, retenção automática e registro de auditoria.
          </p>
        </CardContent>
      </Card>
      {can('contacts:export') ? (
        <Card>
          <CardHeader title="Exportações" />
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="secondary" asChild><a href="/api/app/exports/contacts.csv"><Download className="h-4 w-4" /> Contatos (CSV)</a></Button>
            <Button variant="secondary" asChild><a href="/api/app/exports/crm.csv"><Download className="h-4 w-4" /> CRM (CSV)</a></Button>
            <Button variant="secondary" asChild><a href="/api/app/exports/usage.csv"><Download className="h-4 w-4" /> Consumo (CSV)</a></Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TemplateSettings({ profile }: { profile: CompanyProfile }) {
  const client = useQueryClient();
  const toast = useToast();
  const templates = useQuery({ queryKey: ['templates-list'], queryFn: () => api.get<{ key: string; name: string; description: string }[]>('/app/company/templates') });
  const [key, setKey] = useState(profile.templateKey);
  const apply = useMutation({
    mutationFn: () => api.post('/app/company/template', { templateKey: key, includeAgentDefaults: false }),
    onSuccess: () => { toast.success('Template aplicado: ferramentas, etapas e campos atualizados.'); void client.invalidateQueries(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader title="Modelo de negócio" description="Define regras do segmento, ferramentas da IA, etapas do CRM e campos sugeridos. Nada é apagado ao trocar." />
      <CardContent className="flex flex-wrap items-end gap-3">
        <Field label="Template">{(id) => <Select id={id} value={key} onChange={(event) => setKey(event.target.value)} className="w-72">{(templates.data ?? []).map((item) => <option key={item.key} value={item.key}>{templateLabels[item.key] ?? item.name}</option>)}</Select>}</Field>
        <Button onClick={() => apply.mutate()} loading={apply.isPending}>Aplicar</Button>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const can = useCan();
  const [tab, setTab] = useState('company');
  const profile = useQuery({ queryKey: ['company'], queryFn: () => api.get<CompanyProfile>('/app/company') });
  const tabs = [
    { value: 'company', label: 'Empresa' },
    { value: 'hours', label: 'Horários' },
    ...(can('crm:configure') ? [{ value: 'crm', label: 'CRM' }] : []),
    { value: 'privacy', label: 'Privacidade' },
    ...(can('settings:manage') ? [{ value: 'template', label: 'Modelo' }] : []),
    ...(can('audit:read') ? [{ value: 'audit', label: 'Auditoria' }] : []),
  ];
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Configurações" description="Dados da empresa, assinatura e segurança." />
      <SettingsNav />
      <Tabs value={tab} onValueChange={setTab} items={tabs} className="mb-6" />
      {!profile.data ? <Skeleton className="h-64" /> : (
        <>
          {tab === 'company' ? <Card><CardContent><CompanyProfileForm profile={profile.data} editable={can('company:update')} /></CardContent></Card> : null}
          {tab === 'hours' ? <Card><CardHeader title="Horário de funcionamento" description={`Fuso: ${profile.data.timezone}`} /><CardContent><BusinessHoursEditor key={profile.data.businessHours.length} profile={profile.data} editable={can('settings:manage')} /></CardContent></Card> : null}
          {tab === 'crm' ? <CrmSettings editable={can('crm:configure')} /> : null}
          {tab === 'privacy' ? <PrivacySettings profile={profile.data} editable={can('settings:manage')} /> : null}
          {tab === 'template' ? <TemplateSettings profile={profile.data} /> : null}
          {tab === 'audit' ? <AuditLog /> : null}
        </>
      )}
    </PageContainer>
  );
}
