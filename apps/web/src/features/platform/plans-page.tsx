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
import { featureLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  isActive: boolean;
  limits: Record<string, number | null>;
  features: string[];
  subscriptions: number;
}

const LIMIT_LABELS: Record<string, string> = {
  AI_CALLS_PER_MONTH: 'Atendimentos IA/mês',
  MESSAGES_PER_MONTH: 'Mensagens/mês',
  AI_COST_USD_PER_MONTH: 'Custo IA/mês (US$)',
  USERS: 'Usuários',
  WHATSAPP_NUMBERS: 'Números WhatsApp',
  STORAGE_MB: 'Armazenamento (MB)',
};

function PlanCard({ plan }: { plan: Plan }) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(plan);
  const save = useMutation({
    mutationFn: () => api.patch(`/platform/plans/${plan.id}`, { name: draft.name, description: draft.description, priceCents: draft.priceCents, isActive: draft.isActive, limits: draft.limits, features: draft.features }),
    onSuccess: () => { toast.success('Plano salvo.'); void client.invalidateQueries({ queryKey: ['platform-plans'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{plan.name} <Badge>{plan.key}</Badge></span>} description={`${plan.subscriptions} empresas · ${formatMoneyCents(plan.priceCents)}/mês`} action={<Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="h-4 w-4" /> Salvar</Button>} />
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">{(id) => <Input id={id} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />}</Field>
          <Field label="Preço (centavos)">{(id) => <Input id={id} type="number" value={draft.priceCents} onChange={(event) => setDraft({ ...draft, priceCents: Number(event.target.value) })} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(LIMIT_LABELS).map(([key, label]) => (
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
      <PageHeader title="Planos" description="Estrutura de planos e limites (cobrança real será integrada em fase futura)." />
      {!plans.data ? <Skeleton className="h-96" /> : <div className="grid gap-6 lg:grid-cols-3">{plans.data.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>}
    </PageContainer>
  );
}
