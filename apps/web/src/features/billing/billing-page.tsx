'use client';

import type { BillingInterval } from '@botsaas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, FileText, Receipt } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UsageMeter } from '@/components/charts/daily-bars';
import { PageContainer } from '@/components/layout/company-shell';
import { IntervalToggle } from '@/components/site/pricing';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { EmptyState, PageHeader, Pagination, Skeleton, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatMoneyCents, formatPriceCents } from '@/lib/format';
import { useCan } from '@/lib/session';
import { SettingsNav } from '../settings/settings-nav';
import type { UsageStatus } from '../types';
import { priceFor, usePublicPlans, type PublicPlan } from './plans';

interface Overview {
  billingEnabled: boolean;
  managedBy: 'gateway' | 'manual' | null;
  subscription: {
    status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'UNPAID' | 'INCOMPLETE' | 'PAUSED' | 'CANCELLED';
    interval: BillingInterval;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    trialEndsAt: string | null;
    priceCents: number | null;
    plan: { key: string; name: string; currency: string };
  } | null;
  paymentMethod: { brand: string; last4: string; expMonth: number | null; expYear: number | null } | null;
  usage: UsageStatus;
}

interface Invoice {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
  amountDueCents: number;
  amountPaidCents: number;
  planKey: string | null;
  interval: BillingInterval | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  paymentId: string | null;
  issuedAt: string;
}

const STATUS: Record<NonNullable<Overview['subscription']>['status'], { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Ativa', tone: 'brand' },
  TRIALING: { label: 'Em teste grátis', tone: 'blue' },
  PAST_DUE: { label: 'Pagamento atrasado', tone: 'amber' },
  UNPAID: { label: 'Pagamento pendente', tone: 'red' },
  INCOMPLETE: { label: 'Aguardando pagamento', tone: 'amber' },
  PAUSED: { label: 'Pausada', tone: 'neutral' },
  CANCELLED: { label: 'Cancelada', tone: 'red' },
};

const INVOICE_STATUS: Record<Invoice['status'], { label: string; tone: BadgeTone }> = {
  PAID: { label: 'Paga', tone: 'brand' },
  OPEN: { label: 'Em aberto', tone: 'amber' },
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  VOID: { label: 'Anulada', tone: 'neutral' },
  UNCOLLECTIBLE: { label: 'Não cobrada', tone: 'red' },
};

const ACTIVE_STATUSES = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

function goTo(url: string) {
  window.location.assign(url);
}

function PlanPicker({ overview, onChoose, busyKey }: { overview: Overview; onChoose: (plan: PublicPlan, interval: BillingInterval) => void; busyKey: string | null }) {
  const plans = usePublicPlans();
  const current = overview.subscription;
  const [interval, setBillingInterval] = useState<BillingInterval>(current?.interval ?? 'MONTHLY');
  const hasGateway = overview.managedBy === 'gateway' && current && current.status !== 'CANCELLED';
  if (plans.isLoading) return <Skeleton className="h-64" />;
  if (!plans.data?.length) return <EmptyState title="Planos indisponíveis agora" description="Tente novamente em instantes." />;
  const savings = Math.max(0, ...plans.data.map((plan) => plan.yearlySavings?.percent ?? 0)) || null;
  return (
    <div>
      <IntervalToggle value={interval} onChange={setBillingInterval} savingsPercent={savings} />
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {plans.data.map((plan) => {
          const price = priceFor(plan, interval);
          const isCurrent = hasGateway && current?.plan.key === plan.key && current.interval === interval;
          return (
            <div key={plan.key} className={cn('flex flex-col rounded-xl border p-4', isCurrent ? 'border-brand-600 ring-1 ring-brand-600' : 'border-border')}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-lg font-bold text-foreground">{plan.name}</p>
                {isCurrent ? <Badge tone="brand">Plano atual</Badge> : plan.highlight ? <Badge tone="blue">Mais escolhido</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">{plan.tagline}</p>
              <p className="mt-4 font-display text-2xl font-bold text-foreground">
                {price !== null ? formatPriceCents(price) : '—'}
                <span className="ml-1 text-sm font-normal text-muted">{interval === 'YEARLY' ? '/ano' : '/mês'}</span>
              </p>
              <Button className="mt-4" variant={isCurrent ? 'secondary' : 'primary'} disabled={isCurrent || price === null} loading={busyKey === `${plan.key}-${interval}`} onClick={() => onChoose(plan, interval)}>
                {isCurrent ? 'Plano atual' : hasGateway ? `Trocar para o ${plan.name}` : `Assinar o ${plan.name}`}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BillingPage() {
  const can = useCan();
  const toast = useToast();
  const client = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const [change, setChange] = useState<{ plan: PublicPlan; interval: BillingInterval } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const checkoutResult = params.get('checkout');
  // Guardado fora da URL: a URL é limpa logo na chegada, mas a espera pela ativação continua.
  const [awaitingActivation] = useState(checkoutResult === 'success');

  const overview = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<Overview>('/app/billing'),
    // Logo após o checkout, o webhook pode levar alguns segundos: consulta até ativar.
    refetchInterval: (query) => (awaitingActivation && !ACTIVE_STATUSES.has(query.state.data?.subscription?.status ?? '') ? 3_000 : false),
  });
  const invoices = useQuery({ queryKey: ['invoices', page], queryFn: () => api.get<Paginated<Invoice>>('/app/billing/invoices', { page, pageSize: 10 }) });

  useEffect(() => {
    if (checkoutResult === 'success') toast.success('Pagamento recebido. A assinatura é ativada em instantes.');
    if (checkoutResult === 'cancelled') toast.info('Contratação não concluída. Nada foi cobrado.');
    // Limpa a URL: o aviso aparece uma vez (depois disso `checkoutResult` fica nulo).
    if (checkoutResult) router.replace('/app/settings/billing');
  }, [checkoutResult, router, toast]);

  const refresh = (data?: Overview) => {
    if (data) client.setQueryData(['billing'], data);
    void client.invalidateQueries({ queryKey: ['billing'] });
    void client.invalidateQueries({ queryKey: ['usage-status'] });
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const checkout = useMutation({
    mutationFn: (input: { planKey: string; interval: BillingInterval }) => api.post<{ url: string }>('/app/billing/checkout', input),
    onSuccess: (result) => goTo(result.url),
    onError: (error) => {
      setBusyKey(null);
      onError(error);
    },
  });
  const changePlan = useMutation({
    mutationFn: (input: { planKey: string; interval: BillingInterval }) => api.post<Overview>('/app/billing/change-plan', input),
    onSuccess: (data) => {
      setChange(null);
      refresh(data);
      toast.success(`Plano alterado para ${data.subscription?.plan.name ?? 'o novo plano'}.`);
    },
    onError,
    onSettled: () => setBusyKey(null),
  });
  const portal = useMutation({ mutationFn: () => api.post<{ url: string }>('/app/billing/portal'), onSuccess: (result) => goTo(result.url), onError });
  const cancel = useMutation({
    mutationFn: () => api.post<Overview>('/app/billing/cancel'),
    onSuccess: (data) => {
      setCancelOpen(false);
      refresh(data);
      toast.success('Cancelamento agendado para o fim do período.');
    },
    onError,
  });
  const reactivate = useMutation({
    mutationFn: () => api.post<Overview>('/app/billing/reactivate'),
    onSuccess: (data) => {
      refresh(data);
      toast.success('Assinatura reativada.');
    },
    onError,
  });

  const manage = can('billing:manage');
  const data = overview.data;
  const subscription = data?.subscription ?? null;
  const gateway = data?.managedBy === 'gateway' && subscription && subscription.status !== 'CANCELLED';

  function choose(plan: PublicPlan, interval: BillingInterval) {
    if (gateway) {
      setChange({ plan, interval });
      return;
    }
    setBusyKey(`${plan.key}-${interval}`);
    checkout.mutate({ planKey: plan.key, interval });
  }

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Configurações" description="Dados da empresa, assinatura e segurança." />
      <SettingsNav />
      {overview.isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Assinatura"
              action={subscription ? <Badge tone={subscription.cancelAtPeriodEnd ? 'amber' : STATUS[subscription.status].tone}>{subscription.cancelAtPeriodEnd ? 'Cancelamento agendado' : STATUS[subscription.status].label}</Badge> : null}
            />
            <CardContent>
              {!subscription ? (
                <p className="text-sm text-muted">Nenhum plano contratado.</p>
              ) : (
                <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">Plano</dt>
                    <dd className="mt-1 font-display text-xl font-bold text-foreground">{subscription.plan.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Valor</dt>
                    <dd className="mt-1 font-medium text-foreground">
                      {subscription.priceCents !== null ? formatMoneyCents(subscription.priceCents) : '—'}
                      <span className="text-muted"> {subscription.interval === 'YEARLY' ? 'por ano' : 'por mês'}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">
                      {subscription.status === 'TRIALING' ? 'Teste termina em' : subscription.cancelAtPeriodEnd ? 'Acesso até' : 'Próxima cobrança'}
                    </dt>
                    <dd className="mt-1 font-medium text-foreground">
                      {formatDate(subscription.status === 'TRIALING' ? subscription.trialEndsAt : (subscription.cancelAt ?? subscription.currentPeriodEnd))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Pagamento</dt>
                    <dd className="mt-1 flex items-center gap-2 font-medium text-foreground">
                      {data.paymentMethod ? (
                        <>
                          <CreditCard className="h-4 w-4 text-slate-500" aria-hidden />
                          <span className="capitalize">{data.paymentMethod.brand}</span> •••• {data.paymentMethod.last4}
                        </>
                      ) : data.managedBy === 'manual' && ACTIVE_STATUSES.has(subscription.status) ? (
                        'Gerido pela equipe WebZen'
                      ) : (
                        <span className="font-normal text-muted">Nenhuma forma de pagamento</span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              {subscription && !ACTIVE_STATUSES.has(subscription.status) ? (
                <p role="status" className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
                  O atendimento automático da IA fica pausado até a assinatura estar ativa. Seus dados continuam disponíveis.
                </p>
              ) : null}
              {manage && gateway ? (
                <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
                  <Button variant="secondary" onClick={() => portal.mutate()} loading={portal.isPending}>
                    <CreditCard className="h-4 w-4" /> Atualizar forma de pagamento
                  </Button>
                  {subscription?.cancelAtPeriodEnd ? (
                    <Button onClick={() => reactivate.mutate()} loading={reactivate.isPending}>
                      Reativar assinatura
                    </Button>
                  ) : (
                    <Button variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setCancelOpen(true)}>
                      Cancelar assinatura
                    </Button>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {manage ? (
            <Card>
              <CardHeader
                title={gateway ? 'Trocar de plano' : 'Escolha seu plano'}
                description={
                  !data.billingEnabled
                    ? 'A contratação online ainda não está disponível. Fale com o suporte para mudar de plano.'
                    : gateway
                      ? 'A troca vale na hora. A diferença é calculada proporcionalmente na próxima fatura.'
                      : 'O pagamento é feito na tela segura da Stripe. Cupons de desconto são aceitos lá.'
                }
              />
              {data.billingEnabled ? (
                <CardContent>
                  <PlanPicker overview={data} onChoose={choose} busyKey={busyKey} />
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Consumo do mês" description="Os avisos chegam ao atingir 70% e 90% de cada limite." />
            <CardContent className="grid gap-x-10 gap-y-5 md:grid-cols-2">
              {data.usage.metrics.map((metric) => (
                <UsageMeter key={metric.metric} label={metric.label} current={metric.current} limit={metric.limit} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Faturas" />
            {invoices.isLoading ? (
              <div className="p-5">
                <Skeleton className="h-32" />
              </div>
            ) : !invoices.data?.items.length ? (
              <EmptyState icon={Receipt} title="Nenhuma fatura ainda" description="As faturas aparecem aqui depois da primeira cobrança." />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Data</Th>
                      <Th>Valor</Th>
                      <Th>Plano</Th>
                      <Th>Situação</Th>
                      <Th>ID da transação</Th>
                      <Th>
                        <span className="sr-only">Comprovante</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data.items.map((invoice) => (
                      <tr key={invoice.id}>
                        <Td className="whitespace-nowrap">{formatDate(invoice.issuedAt)}</Td>
                        <Td className="tabular-nums">{formatMoneyCents(invoice.status === 'PAID' ? invoice.amountPaidCents : invoice.amountDueCents)}</Td>
                        <Td>
                          {invoice.planKey ?? '—'}
                          {invoice.interval ? <span className="text-muted"> · {invoice.interval === 'YEARLY' ? 'anual' : 'mensal'}</span> : null}
                        </Td>
                        <Td>
                          <Badge tone={INVOICE_STATUS[invoice.status].tone}>{INVOICE_STATUS[invoice.status].label}</Badge>
                        </Td>
                        <Td className="font-mono text-xs text-muted">{invoice.paymentId ?? '—'}</Td>
                        <Td className="text-right">
                          {invoice.pdfUrl || invoice.hostedUrl ? (
                            <a href={invoice.pdfUrl ?? invoice.hostedUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                              <FileText className="h-4 w-4" aria-hidden /> Comprovante <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={invoices.data.page} pageSize={invoices.data.pageSize} total={invoices.data.total} onPageChange={setPage} />
              </>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(change)}
        onOpenChange={(open) => !open && setChange(null)}
        title={change ? `Trocar para o ${change.plan.name}?` : ''}
        description={
          change
            ? `O novo valor é ${formatMoneyCents(priceFor(change.plan, change.interval))} ${change.interval === 'YEARLY' ? 'por ano' : 'por mês'}. A diferença do período atual é calculada proporcionalmente.`
            : ''
        }
        confirmLabel="Confirmar troca"
        tone="primary"
        loading={changePlan.isPending}
        onConfirm={() => {
          if (!change) return;
          setBusyKey(`${change.plan.key}-${change.interval}`);
          changePlan.mutate({ planKey: change.plan.key, interval: change.interval });
        }}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancelar a assinatura?"
        description={`O plano continua funcionando até ${formatDate(subscription?.currentPeriodEnd)}. Depois disso, o atendimento automático é pausado. Você pode reativar até lá.`}
        confirmLabel="Cancelar assinatura"
        cancelLabel="Manter assinatura"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </PageContainer>
  );
}
