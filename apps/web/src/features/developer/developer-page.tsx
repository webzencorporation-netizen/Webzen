'use client';

import { API_SCOPE_LABELS, API_SCOPES, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type ApiScope, type WebhookEvent } from '@botsaas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RotateCw, Send, Trash2, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { EmptyState, PageHeader, Skeleton, Switch, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { SettingsNav } from '../settings/settings-nav';

interface ApiKeyItem {
  id: string;
  name: string;
  masked: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface EndpointItem {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  isActive: boolean;
  disabledReason: string | null;
  lastDeliveryAt: string | null;
}

interface DeliveryItem {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

/** Mostra um segredo UMA vez, com cópia e aviso claro. */
function SecretReveal({ secret, onClose, title }: { secret: string | null; onClose: () => void; title: string }) {
  const toast = useToast();
  return (
    <Dialog
      open={Boolean(secret)}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description="Copie e guarde num lugar seguro agora. Por segurança, não mostraremos este valor de novo."
      size="md"
      footer={<Button onClick={onClose}>Já copiei</Button>}
    >
      <div className="flex items-center gap-2">
        <code className="block flex-1 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-sm text-white">{secret}</code>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Copiar"
          onClick={() => {
            void navigator.clipboard.writeText(secret ?? '').then(() => toast.success('Copiado.'));
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </Dialog>
  );
}

function CheckList<T extends string>({ options, labels, value, onChange }: { options: readonly T[]; labels: Record<T, string>; value: T[]; onChange: (value: T[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label key={option} className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-brand-600"
            checked={value.includes(option)}
            onChange={(event) => onChange(event.target.checked ? [...value, option] : value.filter((item) => item !== option))}
          />
          <span>
            {labels[option]}
            <span className="block font-mono text-[11px] text-muted">{option}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function ApiKeysCard() {
  const toast = useToast();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; scopes: ApiScope[] }>({ name: '', scopes: ['contacts:read'] });
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyItem | null>(null);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<ApiKeyItem[]>('/app/developer/api-keys') });
  const refresh = () => void client.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: () => api.post<ApiKeyItem & { secret: string }>('/app/developer/api-keys', form),
    onSuccess: (key) => {
      setCreating(false);
      setForm({ name: '', scopes: ['contacts:read'] });
      setSecret(key.secret);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/app/developer/api-keys/${id}`),
    onSuccess: () => {
      setRevoking(null);
      refresh();
      toast.success('Chave revogada. Integrações que a usam deixam de funcionar.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader
        title="Chaves de API"
        description={
          <>
            Para integrar seus sistemas ao WebZen.{' '}
            <Link href="/docs/api" target="_blank" className="text-brand-700 underline">
              Ver documentação
            </Link>
          </>
        }
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Criar chave
          </Button>
        }
      />
      {keys.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-24" />
        </div>
      ) : !keys.data?.length ? (
        <EmptyState icon={KeyRound} title="Nenhuma chave criada" description="Crie uma chave para seu ERP, loja virtual ou automação acessar contatos e mensagens." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Chave</Th>
              <Th>Permissões</Th>
              <Th>Último uso</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {keys.data.map((key) => (
              <tr key={key.id} className={key.revokedAt ? 'opacity-60' : undefined}>
                <Td className="font-medium">
                  {key.name} {key.revokedAt ? <Badge tone="neutral">Revogada</Badge> : null}
                </Td>
                <Td className="font-mono text-xs">{key.masked}</Td>
                <Td className="text-xs text-muted">{key.scopes.map((scope) => API_SCOPE_LABELS[scope]).join(', ')}</Td>
                <Td className="text-muted">{key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Nunca'}</Td>
                <Td className="text-right">
                  {!key.revokedAt ? (
                    <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setRevoking(key)}>
                      Revogar
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Criar chave de API"
        footer={
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.name.trim().length < 2 || form.scopes.length === 0}>
            Criar chave
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" hint="Para você saber onde a chave é usada (ex.: ERP, loja virtual).">
            {(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Permissões</p>
            <CheckList options={API_SCOPES} labels={API_SCOPE_LABELS} value={form.scopes} onChange={(scopes) => setForm({ ...form, scopes })} />
          </div>
        </div>
      </Dialog>
      <SecretReveal secret={secret} onClose={() => setSecret(null)} title="Sua nova chave de API" />
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revogar a chave?"
        description={`Os sistemas que usam "${revoking?.name ?? ''}" deixam de acessar a API imediatamente. Não é possível desfazer.`}
        confirmLabel="Revogar chave"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </Card>
  );
}

function DeliveriesDialog({ endpoint, onClose }: { endpoint: EndpointItem | null; onClose: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', endpoint?.id],
    queryFn: () => api.get<Paginated<DeliveryItem>>(`/app/developer/webhooks/${endpoint?.id}/deliveries`, { pageSize: 20 }),
    enabled: Boolean(endpoint),
    refetchInterval: 5_000,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api.post(`/app/developer/webhook-deliveries/${id}/redeliver`),
    onSuccess: () => {
      toast.success('Reenvio agendado.');
      void client.invalidateQueries({ queryKey: ['webhook-deliveries'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={Boolean(endpoint)} onOpenChange={(open) => !open && onClose()} title="Entregas recentes" description={endpoint?.url} size="lg">
      {!deliveries.data ? (
        <Skeleton className="h-32" />
      ) : deliveries.data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nenhuma entrega ainda. Use "Enviar teste" para conferir a integração.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Quando</Th>
              <Th>Evento</Th>
              <Th>Situação</Th>
              <Th>Tentativas</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {deliveries.data.items.map((delivery) => (
              <tr key={delivery.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(delivery.createdAt)}</Td>
                <Td className="font-mono text-xs">{delivery.event}</Td>
                <Td>
                  <Badge tone={delivery.status === 'SUCCEEDED' ? 'brand' : delivery.status === 'FAILED' ? 'red' : 'blue'}>
                    {delivery.status === 'SUCCEEDED' ? 'Entregue' : delivery.status === 'FAILED' ? 'Falhou' : 'Pendente'}
                    {delivery.responseStatus ? ` · ${delivery.responseStatus}` : ''}
                  </Badge>
                  {delivery.lastError && delivery.status !== 'SUCCEEDED' ? <p className="mt-1 max-w-xs text-xs text-red-700">{delivery.lastError}</p> : null}
                </Td>
                <Td className="tabular-nums">{delivery.attempts}</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => redeliver.mutate(delivery.id)}>
                    <RotateCw className="h-4 w-4" /> Reenviar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  );
}

function WebhooksCard() {
  const toast = useToast();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ url: string; description: string; events: WebhookEvent[] }>({ url: '', description: '', events: ['message.received'] });
  const [secret, setSecret] = useState<string | null>(null);
  const [viewing, setViewing] = useState<EndpointItem | null>(null);
  const [deleting, setDeleting] = useState<EndpointItem | null>(null);
  const [rotating, setRotating] = useState<EndpointItem | null>(null);
  const endpoints = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<EndpointItem[]>('/app/developer/webhooks') });
  const refresh = () => void client.invalidateQueries({ queryKey: ['webhooks'] });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const create = useMutation({
    mutationFn: () => api.post<EndpointItem & { secret: string }>('/app/developer/webhooks', { ...form, description: form.description || null }),
    onSuccess: (endpoint) => {
      setAdding(false);
      setForm({ url: '', description: '', events: ['message.received'] });
      setSecret(endpoint.secret);
      refresh();
    },
    onError,
  });
  const toggle = useMutation({ mutationFn: (endpoint: EndpointItem) => api.patch(`/app/developer/webhooks/${endpoint.id}`, { isActive: !endpoint.isActive }), onSuccess: refresh, onError });
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/app/developer/webhooks/${id}/test`),
    onSuccess: () => toast.success('Evento de teste enviado. Acompanhe em "Entregas".'),
    onError,
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.post<{ secret: string }>(`/app/developer/webhooks/${id}/rotate-secret`),
    onSuccess: (result) => {
      setRotating(null);
      setSecret(result.secret);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/app/developer/webhooks/${id}`),
    onSuccess: () => {
      setDeleting(null);
      refresh();
      toast.success('Endpoint excluído.');
    },
    onError,
  });

  return (
    <Card>
      <CardHeader
        title="Webhooks"
        description="Avisos em tempo real para os seus sistemas quando algo acontece no WebZen. Cada envio é assinado (X-WebZen-Signature)."
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Adicionar endpoint
          </Button>
        }
      />
      {endpoints.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-24" />
        </div>
      ) : !endpoints.data?.length ? (
        <EmptyState icon={Webhook} title="Nenhum endpoint" description="Cadastre uma URL para receber eventos como nova mensagem, novo lead ou conversa encerrada." />
      ) : (
        <ul className="divide-y divide-border">
          {endpoints.data.map((endpoint) => (
            <li key={endpoint.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">{endpoint.url}</p>
                <p className="text-xs text-muted">
                  {endpoint.events.length} {endpoint.events.length === 1 ? 'evento' : 'eventos'}
                  {endpoint.lastDeliveryAt ? ` · última entrega ${formatRelative(endpoint.lastDeliveryAt)}` : ''}
                  {endpoint.description ? ` · ${endpoint.description}` : ''}
                </p>
                {endpoint.disabledReason ? <p className="mt-1 text-xs text-amber-700">{endpoint.disabledReason}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Switch checked={endpoint.isActive} onCheckedChange={() => toggle.mutate(endpoint)} label={endpoint.isActive ? 'Desativar endpoint' : 'Ativar endpoint'} />
                <Button variant="ghost" size="sm" onClick={() => test.mutate(endpoint.id)} disabled={!endpoint.isActive}>
                  <Send className="h-4 w-4" /> Enviar teste
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setViewing(endpoint)}>
                  Entregas
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRotating(endpoint)}>
                  Novo segredo
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(endpoint)} aria-label="Excluir endpoint">
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Adicionar endpoint"
        size="lg"
        footer={
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.url.startsWith('http') || form.events.length === 0}>
            Adicionar endpoint
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="URL" hint="Em produção, só https:// e endereços públicos.">
            {(id) => <Input id={id} value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://seu-sistema.com.br/webhooks/webzen" />}
          </Field>
          <Field label="Descrição (opcional)">{(id) => <Input id={id} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}</Field>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Eventos</p>
            <CheckList options={WEBHOOK_EVENTS} labels={WEBHOOK_EVENT_LABELS} value={form.events} onChange={(events) => setForm({ ...form, events })} />
          </div>
        </div>
      </Dialog>
      <SecretReveal secret={secret} onClose={() => setSecret(null)} title="Segredo de assinatura do webhook" />
      <DeliveriesDialog endpoint={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={Boolean(rotating)}
        onOpenChange={(open) => !open && setRotating(null)}
        title="Gerar novo segredo?"
        description="O segredo atual deixa de valer imediatamente. Atualize o seu sistema com o novo valor para continuar validando as assinaturas."
        confirmLabel="Gerar novo segredo"
        tone="primary"
        loading={rotate.isPending}
        onConfirm={() => rotating && rotate.mutate(rotating.id)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir endpoint?"
        description={`${deleting?.url ?? ''} deixa de receber eventos e o histórico de entregas é apagado.`}
        confirmLabel="Excluir endpoint"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

export function DeveloperPage() {
  const features = useQuery({ queryKey: ['features'], queryFn: () => api.get<{ flag: string; enabled: boolean }[]>('/app/company/features') });
  const enabled = new Set((features.data ?? []).filter((item) => item.enabled).map((item) => item.flag));
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Configurações" description="Dados da empresa, assinatura e segurança." />
      <SettingsNav />
      {!features.data ? (
        <Skeleton className="h-64" />
      ) : !enabled.has('API_ACCESS') && !enabled.has('WEBHOOKS') ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={KeyRound}
              title="API e webhooks fazem parte do plano Business"
              description="Conecte seu ERP, loja virtual ou automações ao WebZen com chaves de API e receba eventos em tempo real."
              action={
                <Button asChild>
                  <Link href="/app/settings/billing">Ver planos</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {enabled.has('API_ACCESS') ? <ApiKeysCard /> : null}
          {enabled.has('WEBHOOKS') ? <WebhooksCard /> : null}
        </div>
      )}
    </PageContainer>
  );
}
