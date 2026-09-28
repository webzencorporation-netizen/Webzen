'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, FlaskConical, XCircle } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { roleLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCanPlatform } from '@/lib/session';

interface Health {
  overall: string;
  checkedAt: string;
  providers: Record<string, string | boolean>;
  components: Record<string, { status: string; detail?: string }>;
}
interface Pricing { id: string; model: string; displayName: string | null; inputUsdPerMTok: number; outputUsdPerMTok: number; cacheWriteUsdPerMTok: number; cacheReadUsdPerMTok: number; isActive: boolean; updatedAt: string }

const COMPONENT_LABELS: Record<string, string> = { database: 'Banco de dados', redis: 'Redis', workers: 'Workers', anthropic: 'Anthropic (IA)', whatsapp: 'WhatsApp', storage: 'Armazenamento', calendar: 'Agenda (Google)' };

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-brand-600" />;
  if (status === 'mock') return <FlaskConical className="h-5 w-5 text-amber-500" />;
  if (status === 'not_configured') return <CircleDashed className="h-5 w-5 text-slate-400" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function PricingRow({ row }: { row: Pricing }) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(row);
  const save = useMutation({
    mutationFn: () => api.put(`/platform/pricing/${row.model}`, { displayName: draft.displayName, inputUsdPerMTok: draft.inputUsdPerMTok, outputUsdPerMTok: draft.outputUsdPerMTok, cacheWriteUsdPerMTok: draft.cacheWriteUsdPerMTok, cacheReadUsdPerMTok: draft.cacheReadUsdPerMTok, isActive: draft.isActive }),
    onSuccess: () => { toast.success('Preço atualizado.'); void client.invalidateQueries({ queryKey: ['pricing'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const num = (key: 'inputUsdPerMTok' | 'outputUsdPerMTok' | 'cacheWriteUsdPerMTok' | 'cacheReadUsdPerMTok') => (
    <Input type="number" step="0.01" min={0} className="h-8 w-24 text-right text-xs" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} aria-label={key} />
  );
  return (
    <tr>
      <Td className="font-mono text-xs">{row.model}</Td>
      <Td>{num('inputUsdPerMTok')}</Td>
      <Td>{num('outputUsdPerMTok')}</Td>
      <Td>{num('cacheWriteUsdPerMTok')}</Td>
      <Td>{num('cacheReadUsdPerMTok')}</Td>
      <Td className="text-xs text-muted">{formatDateTime(row.updatedAt)}</Td>
      <Td><Button size="sm" variant="secondary" onClick={() => save.mutate()} loading={save.isPending}>Salvar</Button></Td>
    </tr>
  );
}

export function PlatformAdminPage() {
  const client = useQueryClient();
  const toast = useToast();
  const canPlatform = useCanPlatform();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/platform/health'), refetchInterval: 30_000 });
  const pricing = useQuery({ queryKey: ['pricing'], queryFn: () => api.get<Pricing[]>('/platform/pricing') });
  const admins = useQuery({ queryKey: ['platform-admins'], queryFn: () => api.get<{ id: string; email: string; name: string; platformRole: string; lastLoginAt: string | null }[]>('/platform/admins'), enabled: canPlatform('platform:admins:manage') });
  const [adminForm, setAdminForm] = useState({ name: '', email: '', password: '', platformRole: 'PLATFORM_ADMIN' });
  const addAdmin = useMutation({
    mutationFn: () => api.post('/platform/admins', adminForm),
    onSuccess: () => { toast.success('Administrador adicionado.'); setAdminForm({ name: '', email: '', password: '', platformRole: 'PLATFORM_ADMIN' }); void client.invalidateQueries({ queryKey: ['platform-admins'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <PageContainer>
      <PageHeader title="Administração" description="Saúde da plataforma, preços dos modelos e administradores." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Status da plataforma" description={health.data ? `Verificado em ${formatDateTime(health.data.checkedAt)}` : undefined} action={health.data ? <Badge tone={health.data.overall === 'ok' ? 'brand' : health.data.overall === 'degraded' ? 'amber' : 'red'}>{health.data.overall}</Badge> : null} />
          {!health.data ? <Skeleton className="m-4 h-24" /> : (
            <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {Object.entries(health.data.components).map(([key, component]) => (
                <div key={key} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <StatusIcon status={component.status} />
                  <div>
                    <p className="text-sm font-medium">{COMPONENT_LABELS[key] ?? key}</p>
                    <p className="text-xs text-muted">{component.status === 'mock' ? 'Simulado (dev)' : component.status === 'not_configured' ? 'Não configurado' : component.detail ?? component.status}</p>
                  </div>
                </div>
              ))}
              <div className="rounded-lg bg-surface-muted p-3 text-xs text-muted md:col-span-2 lg:col-span-4">
                Providers ativos: {Object.entries(health.data.providers).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader title="Preços dos modelos (US$ por milhão de tokens)" description="Usados para estimar custos. Atualize quando a Anthropic alterar preços." />
          {!pricing.data ? <Skeleton className="m-4 h-32" /> : (
            <Table>
              <thead><tr><Th>Modelo</Th><Th>Entrada</Th><Th>Saída</Th><Th>Escrita cache</Th><Th>Leitura cache</Th><Th>Atualizado</Th><Th /></tr></thead>
              <tbody>{pricing.data.map((row) => <PricingRow key={row.id} row={row} />)}</tbody>
            </Table>
          )}
        </Card>

        {canPlatform('platform:admins:manage') ? (
          <Card>
            <CardHeader title="Administradores da plataforma" />
            <ul className="divide-y divide-border text-sm">
              {(admins.data ?? []).map((admin) => (
                <li key={admin.id} className="flex items-center justify-between px-5 py-2.5">
                  <span><span className="font-medium">{admin.name}</span> <span className="text-muted">· {admin.email}</span></span>
                  <span className="flex items-center gap-3 text-xs text-muted">último acesso {formatDateTime(admin.lastLoginAt)} <Badge>{roleLabels[admin.platformRole]}</Badge></span>
                </li>
              ))}
            </ul>
            <CardContent className="grid gap-3 border-t border-border md:grid-cols-5">
              <Field label="Nome">{(id) => <Input id={id} value={adminForm.name} onChange={(event) => setAdminForm({ ...adminForm, name: event.target.value })} />}</Field>
              <Field label="E-mail">{(id) => <Input id={id} type="email" value={adminForm.email} onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })} />}</Field>
              <Field label="Senha inicial">{(id) => <Input id={id} type="password" value={adminForm.password} onChange={(event) => setAdminForm({ ...adminForm, password: event.target.value })} />}</Field>
              <Field label="Papel">{(id) => <Select id={id} value={adminForm.platformRole} onChange={(event) => setAdminForm({ ...adminForm, platformRole: event.target.value })}><option value="PLATFORM_ADMIN">Admin</option><option value="PLATFORM_OWNER">Dono</option></Select>}</Field>
              <div className="flex items-end"><Button className="w-full" onClick={() => addAdmin.mutate()} disabled={!adminForm.email || adminForm.password.length < 10} loading={addAdmin.isPending}>Adicionar</Button></div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  );
}
