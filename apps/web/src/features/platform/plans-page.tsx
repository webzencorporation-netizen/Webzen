'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { PageHeader, Skeleton, Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { featureLabels, usageMetricLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';

interface Plan {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
  stripePriceMonthlyId: string | null;
  stripePriceYearlyId: string | null;
  isActive: boolean;
  isPublic: boolean;
  highlight: boolean;
  limits: Record<string, number | null>;
  features: string[];
  subscriptions: number;
}


function PlanCard({ plan }: { plan: Plan }) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(plan);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/platform/plans/${plan.id}`, {
        name: draft.name,
        tagline: draft.tagline,
        description: draft.description,
        priceMonthlyCents: draft.priceMonthlyCents,
        priceYearlyCents: draft.priceYearlyCents,
        stripePriceMonthlyId: draft.stripePriceMonthlyId || null,
        stripePriceYearlyId: draft.stripePriceYearlyId || null,
        isActive: draft.isActive,
        isPublic: draft.isPublic,
        highlight: draft.highlight,
        limits: draft.limits,
        features: draft.features,
      }),
    onSuccess: () => { toast.success('Plano salvo.'); void client.invalidateQueries({ queryKey: ['platform-plans'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{plan.name} <Badge>{plan.key}</Badge></span>} description={`${plan.subscriptions} empresas · ${formatMoneyCents(plan.priceMonthlyCents)}/mês${plan.priceYearlyCents !== null ? ` · ${formatMoneyCents(plan.priceYearlyCents)}/ano` : ''}`} action={<Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="h-4 w-4" /> Salvar</Button>} />
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">{(id) => <Input id={id} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />}</Field>
          <Field label="Frase do card">{(id) => <Input id={id} value={draft.tagline ?? ''} onChange={(event) => setDraft({ ...draft, tagline: event.target.value || null })} />}</Field>
          <Field label="Preço mensal (centavos)">{(id) => <Input id={id} type="number" min={0} value={draft.priceMonthlyCents} onChange={(event) => setDraft({ ...draft, priceMonthlyCents: Number(event.target.value) })} />}</Field>
          <Field label="Preço anual (centavos)" hint="Vazio = sem plano anual">{(id) => <Input id={id} type="number" min={0} value={draft.priceYearlyCents ?? ''} onChange={(event) => setDraft({ ...draft, priceYearlyCents: event.target.value === '' ? null : Number(event.target.value) })} />}</Field>
          <Field label="Stripe — preço mensal" hint="price_...">{(id) => <Input id={id} value={draft.stripePriceMonthlyId ?? ''} onChange={(event) => setDraft({ ...draft, stripePriceMonthlyId: event.target.value.trim() || null })} />}</Field>
          <Field label="Stripe — preço anual" hint="price_...">{(id) => <Input id={id} value={draft.stripePriceYearlyId ?? ''} onChange={(event) => setDraft({ ...draft, stripePriceYearlyId: event.target.value.trim() || null })} />}</Field>
        </div>
        <p className="text-xs text-muted">Ao mudar um preço, crie o novo preço na Stripe e atualize o ID: a cobrança é recusada se o valor da Stripe divergir do valor do plano.</p>
        <div className="space-y-2">
          {([['isActive', 'Plano ativo'], ['isPublic', 'Visível na página de preços'], ['highlight', 'Destacar como recomendado']] as const).map(([field, label]) => (
            <label key={field} className="flex items-center justify-between text-sm">
              {label}
              <Switch checked={draft[field]} onCheckedChange={(checked) => setDraft({ ...draft, [field]: checked })} label={label} />
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(usageMetricLabels).map(([key, label]) => (
            <Field key={key} label={label}>{(id) => <Input id={id} type="number" min={0} value={draft.limits[key] ?? ''} placeholder="ilimitado" onChange={(event) => setDraft({ ...draft, limits: { ...draft.limits, [key]: event.target.value === '' ? null : Number(event.target.value) } })} />}</Field>
          ))}
        </div>
        <div className="space-y-2">
          {Object.entries(featureLabels).map(([flag, label]) => (
            <label key={flag} className="flex items-center justify-between text-sm">
              {label}
              <Switch checked={draft.features.includes(flag)} onCheckedChange={(checked) => setDraft({ ...draft, features: checked ? [...draft.features, flag] : draft.features.filter((item) => item !== flag) })} label={label} />
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PlansPage() {
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<Plan[]>('/platform/plans') });
  return (
    <PageContainer>
      <PageHeader title="Planos" description="Preços, limites e recursos de cada plano. Estes valores valem para o checkout, a página de preços e os limites do painel." />
      {!plans.data ? <Skeleton className="h-96" /> : <div className="grid gap-6 lg:grid-cols-3">{plans.data.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>}
    </PageContainer>
  );
}
