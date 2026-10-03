'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Copy, FlaskConical, MessageCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { integrationStatusLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Integrations {
  whatsapp: {
    provider: 'cloud' | 'mock';
    graphApiVersion: string;
    webhookUrl: string;
    webhookConfigured: boolean;
    embeddedSignupAvailable: boolean;
    templatesCount: number;
    accounts: {
      id: string;
      phoneNumberId: string;
      wabaId: string | null;
      displayPhoneNumber: string | null;
      verifiedName: string | null;
      status: string;
      qualityRating: string | null;
      isDefault: boolean;
      lastError: string | null;
      lastWebhookAt: string | null;
      tokenConfigured: boolean;
    }[];
  };
  googleCalendar: { available: boolean; status: string; calendarId: string | null; lastSyncAt: string | null; lastError: string | null };
}

const STATUS_TONE: Record<string, BadgeTone> = { CONNECTED: 'brand', ERROR: 'red', PENDING: 'amber', DISCONNECTED: 'neutral' };

function AddNumberDialog({ open, onOpenChange, mock }: { open: boolean; onOpenChange: (open: boolean) => void; mock: boolean }) {
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', displayPhoneNumber: '' });
  const add = useMutation({
    mutationFn: () => api.post('/app/integrations/whatsapp/accounts', { phoneNumberId: form.phoneNumberId, wabaId: form.wabaId || null, accessToken: form.accessToken || null, displayPhoneNumber: form.displayPhoneNumber || null }),
    onSuccess: () => { toast.success('Número conectado.'); void client.invalidateQueries({ queryKey: ['integrations'] }); onOpenChange(false); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Conectar número do WhatsApp" description="Dados do número na WhatsApp Business Platform (Cloud API oficial da Meta)." size="lg" footer={<Button onClick={() => add.mutate()} loading={add.isPending} disabled={!form.phoneNumberId}>Conectar</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Phone number ID" hint="Em Meta for Developers → WhatsApp → API Setup.">{(id) => <Input id={id} value={form.phoneNumberId} inputMode="numeric" onChange={(event) => setForm({ ...form, phoneNumberId: event.target.value.trim() })} />}</Field>
        <Field label="WhatsApp Business Account ID (WABA)" hint="Necessário para sincronizar templates.">{(id) => <Input id={id} value={form.wabaId} inputMode="numeric" onChange={(event) => setForm({ ...form, wabaId: event.target.value.trim() })} />}</Field>
        <Field label="Token de acesso" className="md:col-span-2" hint={mock ? 'Opcional em modo de desenvolvimento.' : 'Use um token de System User. Ele é criptografado e nunca é exibido novamente.'}>
          {(id) => <Textarea id={id} value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value.trim() })} className="min-h-[70px] font-mono text-xs" autoComplete="off" />}
        </Field>
        <Field label="Número exibido (opcional)">{(id) => <Input id={id} value={form.displayPhoneNumber} onChange={(event) => setForm({ ...form, displayPhoneNumber: event.target.value })} placeholder="+55 11 4000-0000" />}</Field>
      </div>
    </Dialog>
  );
}

function SimulatorCard() {
  const client = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState('11999990000');
  const [name, setName] = useState('Cliente Simulado');
  const [text, setText] = useState('Olá! Quais serviços vocês oferecem?');
  const simulate = useMutation({
    mutationFn: () => api.post('/app/integrations/whatsapp/simulate', { from, name, text }),
    onSuccess: () => { toast.success('Mensagem simulada recebida. Veja em Conversas.'); void client.invalidateQueries({ queryKey: ['conversations'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader title="Simulador de WhatsApp" description="Modo de desenvolvimento: gera uma mensagem de cliente que segue o mesmo fluxo do webhook real." />
      <CardContent className="grid gap-3 md:grid-cols-[180px_180px_1fr_auto]">
        <Input value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Telefone do cliente" />
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome do cliente" />
        <Input value={text} onChange={(event) => setText(event.target.value)} aria-label="Mensagem" />
        <Button onClick={() => simulate.mutate()} loading={simulate.isPending}><FlaskConical className="h-4 w-4" /> Simular</Button>
      </CardContent>
    </Card>
  );
}

export function IntegrationsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integrations>('/app/integrations') });
  const refresh = () => void client.invalidateQueries({ queryKey: ['integrations'] });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const verify = useMutation({ mutationFn: (id: string) => api.post<{ status: string; error?: string }>(`/app/integrations/whatsapp/accounts/${id}/verify`), onSuccess: (result) => { refresh(); if (result.status === 'CONNECTED') toast.success('Conexão OK.'); else toast.error(result.error ?? 'Falha na conexão.'); }, onError });
  const sync = useMutation({ mutationFn: (id: string) => api.post<{ synced: number }>(`/app/integrations/whatsapp/accounts/${id}/templates/sync`), onSuccess: (result) => { refresh(); toast.success(`${result.synced} templates sincronizados.`); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/app/integrations/whatsapp/accounts/${id}`), onSuccess: () => { setRemoving(null); refresh(); }, onError });
  const googleConnect = useMutation({ mutationFn: () => api.post<{ url: string }>('/app/integrations/google/connect'), onSuccess: (result) => { window.location.href = result.url; }, onError });
  const googleDisconnect = useMutation({ mutationFn: () => api.delete('/app/integrations/google'), onSuccess: refresh, onError });

  const googleStatus = params.get('google');
  useEffect(() => {
    if (googleStatus === 'connected') toast.success('Google Agenda conectado.');
    if (googleStatus === 'error' || googleStatus === 'forbidden') toast.error('Não foi possível conectar o Google Agenda.');
  }, [googleStatus, toast]);

  if (integrations.isLoading || !integrations.data) return <PageContainer><Skeleton className="h-64" /></PageContainer>;
  const { whatsapp, googleCalendar } = integrations.data;
  const manage = can('integrations:manage');

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Integrações" description="Canais e ferramentas conectados ao atendimento." />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-brand-600" /> WhatsApp</span>}
            description={whatsapp.provider === 'mock' ? 'Modo de desenvolvimento: nenhuma mensagem é enviada à Meta.' : `API oficial da Meta · Graph API ${whatsapp.graphApiVersion}`}
            action={manage ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Conectar número</Button> : null}
          />
          <CardContent className="space-y-4">
            {whatsapp.accounts.length === 0 ? <p className="text-sm text-muted">Nenhum número conectado ainda.</p> : null}
            {whatsapp.accounts.map((account) => (
              <div key={account.id} className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {account.displayPhoneNumber ?? account.phoneNumberId}
                    <Badge tone={STATUS_TONE[account.status] ?? 'neutral'}>{integrationStatusLabels[account.status]}</Badge>
                    {account.isDefault ? <Badge tone="blue">Principal</Badge> : null}
                    {account.qualityRating ? <Badge>Qualidade: {account.qualityRating}</Badge> : null}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {account.verifiedName ?? 'Nome não verificado'} · ID {account.phoneNumberId} · último evento {formatDateTime(account.lastWebhookAt)}
                  </p>
                  {account.lastError ? <p className="mt-1 text-xs text-red-600">{account.lastError}</p> : null}
                </div>
                {manage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => verify.mutate(account.id)} loading={verify.isPending}><CheckCircle2 className="h-4 w-4" /> Testar</Button>
                    <Button size="sm" variant="secondary" onClick={() => sync.mutate(account.id)} loading={sync.isPending}><RefreshCw className="h-4 w-4" /> Templates</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(account.id)} aria-label="Remover número"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                ) : null}
              </div>
            ))}
            {manage ? (
              <div className="rounded-lg bg-surface-muted p-4 text-sm">
                <p className="font-medium">Webhook (configurar no app da Meta)</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-xs ring-1 ring-border">{whatsapp.webhookUrl}</code>
                  <Button size="icon-sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(whatsapp.webhookUrl); toast.success('URL copiada.'); }} aria-label="Copiar URL"><Copy className="h-4 w-4" /></Button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Assine o campo <code>messages</code>. {whatsapp.webhookConfigured ? 'Token de verificação e App Secret configurados na plataforma.' : 'Atenção: token de verificação/App Secret ainda não configurados na plataforma.'}
                  {' '}{whatsapp.templatesCount} templates sincronizados.
                  {whatsapp.embeddedSignupAvailable ? ' Conexão self-service (Embedded Signup) disponível em breve.' : ''}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {whatsapp.provider === 'mock' && manage ? <SimulatorCard /> : null}

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-sky-600" /> Google Agenda</span>}
            description="Sincroniza os agendamentos e bloqueia horários ocupados no seu calendário."
            action={<Badge tone={STATUS_TONE[googleCalendar.status] ?? 'neutral'}>{integrationStatusLabels[googleCalendar.status]}</Badge>}
          />
          <CardContent>
            {!googleCalendar.available ? (
              <p className="text-sm text-muted">A integração com o Google ainda não foi habilitada pela plataforma. A agenda interna funciona normalmente.</p>
            ) : googleCalendar.status === 'CONNECTED' ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">Calendário: {googleCalendar.calendarId} · última sincronização {formatDateTime(googleCalendar.lastSyncAt)}</p>
                {manage ? <Button variant="secondary" size="sm" onClick={() => googleDisconnect.mutate()}>Desconectar</Button> : null}
              </div>
            ) : manage ? (
              <Button onClick={() => googleConnect.mutate()} loading={googleConnect.isPending}>Conectar Google Agenda</Button>
            ) : null}
            {googleCalendar.lastError ? <p className="mt-2 text-xs text-red-600">{googleCalendar.lastError}</p> : null}
          </CardContent>
        </Card>
      </div>
      <AddNumberDialog open={adding} onOpenChange={setAdding} mock={whatsapp.provider === 'mock'} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)} title="Remover número?" description="O atendimento por este número será interrompido. As conversas existentes continuam no painel." confirmLabel="Remover" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} />
    </PageContainer>
  );
}
