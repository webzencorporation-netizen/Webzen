'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Eye, FlaskConical, Plus, Power, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { PageHeader, Skeleton, Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { effortLabels, emojiLabels, fallbackLabels, lengthLabels, toneLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/session';
import { PromptPreviewDialog } from './prompt-preview-dialog';
import type { AiConfig, AiSettings } from './types';

type Draft = Omit<AiConfig, 'id' | 'effectiveModel' | 'version' | 'updatedAt'>;

const CATEGORY_LABELS: Record<string, string> = {
  info: 'Informações',
  catalog: 'Catálogo',
  contact: 'Cliente',
  crm: 'CRM',
  calendar: 'Agenda',
  handoff: 'Atendimento humano',
};

function Segmented({ value, options, onChange, disabled }: { value: string; options: Record<string, string>; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup">
      {Object.entries(options).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          disabled={disabled}
          onClick={() => onChange(key)}
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', value === key ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AgentSettings() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const editable = can('ai:configure');
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('/app/ai') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newRule, setNewRule] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (settings.data && !draft) {
      const { id: _id, effectiveModel: _model, version: _version, updatedAt: _updated, ...rest } = settings.data.config;
      setDraft(rest);
    }
  }, [settings.data, draft]);

  const dirty = useMemo(() => {
    if (!draft || !settings.data) return false;
    return (Object.keys(draft) as (keyof Draft)[]).some((key) => JSON.stringify(draft[key]) !== JSON.stringify(settings.data.config[key]));
  }, [draft, settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const changes = Object.fromEntries((Object.keys(draft ?? {}) as (keyof Draft)[]).filter((key) => JSON.stringify(draft?.[key]) !== JSON.stringify(settings.data?.config[key])).map((key) => [key, draft?.[key]]));
      return api.patch('/app/ai/config', changes);
    },
    onSuccess: async () => {
      toast.success('Configurações do agente salvas.');
      setDraft(null);
      await client.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const toggleTool = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => api.put('/app/ai/tools', { tools: { [name]: enabled } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['ai-settings'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const emergency = useMutation({
    mutationFn: () => api.post('/app/ai/emergency-stop'),
    onSuccess: async () => {
      setStopOpen(false);
      setDraft(null);
      toast.success('IA desativada para toda a empresa.');
      await client.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });

  if (settings.isLoading || !settings.data || !draft) {
    return (
      <PageContainer>
        <Skeleton className="mb-6 h-10 w-64" />
        <Skeleton className="h-64" />
      </PageContainer>
    );
  }
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const { tools, models, provider } = settings.data;
  const grouped = Object.entries(
    tools.reduce<Record<string, typeof tools>>((groups, tool) => ({ ...groups, [tool.category]: [...(groups[tool.category] ?? []), tool] }), {}),
  );

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="Agente de IA"
        description="Personalidade, regras e ferramentas do atendente virtual."
        actions={
          <>
            {can('ai:prompt_preview') ? (
              <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
                <Eye className="h-4 w-4" /> Ver prompt
              </Button>
            ) : null}
            {can('ai:test') ? (
              <Button variant="outline" asChild>
                <Link href="/app/agent/test"><FlaskConical className="h-4 w-4" /> Testar agente</Link>
              </Button>
            ) : null}
            {editable ? (
              <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
                <Save className="h-4 w-4" /> Salvar
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className={cn('flex h-11 w-11 items-center justify-center rounded-full', draft.enabled ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>
                <Power className="h-5 w-5" />
              </div>
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  Status: {draft.enabled ? <Badge tone="brand">ATIVO</Badge> : <Badge>PAUSADO</Badge>}
                  {provider === 'mock' ? <Badge tone="amber">modo simulação</Badge> : null}
                </p>
                <p className="text-sm text-muted">Quando ativo, o atendente responde automaticamente as conversas em modo IA.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={draft.enabled} onCheckedChange={(value) => set('enabled', value)} disabled={!editable} label="Ativar atendente virtual" />
              {can('ai:emergency_stop') && settings.data.config.enabled ? (
                <Button variant="danger" size="sm" onClick={() => setStopOpen(true)}>
                  <AlertOctagon className="h-4 w-4" /> Desativar agora
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Identidade e personalidade" description="Como o atendente se apresenta e conversa." />
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field label="Nome do atendente">{(id) => <Input id={id} value={draft.agentName} disabled={!editable} onChange={(event) => set('agentName', event.target.value)} />}</Field>
            <Field label="Personalidade" hint="Ex.: acolhedora, paciente e objetiva.">
              {(id) => <Input id={id} value={draft.personality ?? ''} disabled={!editable} onChange={(event) => set('personality', event.target.value || null)} />}
            </Field>
            <div className="space-y-1.5 md:col-span-2">
              <p className="text-sm font-medium text-slate-700">Tom</p>
              <Segmented value={draft.tone} options={toneLabels} onChange={(value) => set('tone', value)} disabled={!editable} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Tamanho das respostas</p>
              <Segmented value={draft.responseLength} options={lengthLabels} onChange={(value) => set('responseLength', value)} disabled={!editable} />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Emojis</p>
              <Segmented value={draft.emojiUsage} options={emojiLabels} onChange={(value) => set('emojiUsage', value)} disabled={!editable} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Mensagens" description="Textos-base que o atendente adapta ao contexto." />
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field label="Mensagem inicial">{(id) => <Textarea id={id} value={draft.greetingMessage ?? ''} disabled={!editable} onChange={(event) => set('greetingMessage', event.target.value || null)} />}</Field>
            <Field label="Mensagem fora do horário">{(id) => <Textarea id={id} value={draft.outOfHoursMessage ?? ''} disabled={!editable} onChange={(event) => set('outOfHoursMessage', event.target.value || null)} />}</Field>
            <Field label="Mensagem ao transferir para a equipe">{(id) => <Textarea id={id} value={draft.handoffMessage ?? ''} disabled={!editable} onChange={(event) => set('handoffMessage', event.target.value || null)} />}</Field>
            <Field label="Mensagem de contingência" hint="Usada quando a IA estiver indisponível (se escolhido abaixo).">
              {(id) => <Textarea id={id} value={draft.fallbackMessage ?? ''} disabled={!editable} onChange={(event) => set('fallbackMessage', event.target.value || null)} />}
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Responder fora do horário de funcionamento</p>
                <p className="text-xs text-muted">Se desligado, o cliente recebe apenas a mensagem de fora do horário.</p>
              </div>
              <Switch checked={draft.respondOutsideHours} onCheckedChange={(value) => set('respondOutsideHours', value)} disabled={!editable} label="Responder fora do horário" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Regras da empresa" description="Orientações específicas que o atendente sempre deve seguir." />
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {draft.customRules.map((rule, index) => (
                <li key={`${rule}-${index}`} className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
                  <span className="flex-1">{rule}</span>
                  {editable ? (
                    <button onClick={() => set('customRules', draft.customRules.filter((_, position) => position !== index))} className="text-slate-400 hover:text-red-600" aria-label="Remover regra">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {editable ? (
              <div className="flex gap-2">
                <Input value={newRule} onChange={(event) => setNewRule(event.target.value)} placeholder="Ex.: Não informar valores de botox sem avaliação." aria-label="Nova regra" />
                <Button variant="secondary" disabled={newRule.trim().length < 3} onClick={() => { set('customRules', [...draft.customRules, newRule.trim()]); setNewRule(''); }}>
                  <Plus className="h-4 w-4" /> Adicionar
                </Button>
              </div>
            ) : null}
            <Field label="Instruções adicionais">
              {(id) => <Textarea id={id} value={draft.additionalInstructions ?? ''} disabled={!editable} onChange={(event) => set('additionalInstructions', event.target.value || null)} className="min-h-[110px]" />}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Comportamento" />
          <CardContent className="grid gap-6 md:grid-cols-2">
            <Field label={`Agrupar mensagens: aguardar ${draft.messageBufferSeconds}s`} hint="Espera o cliente terminar de digitar várias mensagens antes de responder uma única vez.">
              {(id) => <input id={id} type="range" min={0} max={15} value={draft.messageBufferSeconds} disabled={!editable} onChange={(event) => set('messageBufferSeconds', Number(event.target.value))} className="w-full accent-brand-600" />}
            </Field>
            <Field label="Se a IA falhar ou atingir o limite">
              {(id) => (
                <Select id={id} value={draft.fallbackBehavior} disabled={!editable} onChange={(event) => set('fallbackBehavior', event.target.value)}>
                  {Object.entries(fallbackLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Ferramentas permitidas" description="Ações que o atendente pode executar. Todas passam por validação no servidor." />
          <CardContent className="grid gap-6 md:grid-cols-2">
            {grouped.map(([category, items]) => (
              <div key={category}>
                <p className="mb-2 text-xs font-semibold text-muted">{CATEGORY_LABELS[category] ?? category}</p>
                <ul className="space-y-2">
                  {items.map((tool) => (
                    <li key={tool.name} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <span className="text-sm">
                        {tool.label}
                        {tool.recommended ? <span className="ml-2 text-[11px] text-brand-700">recomendado</span> : null}
                      </span>
                      <Switch checked={tool.enabled} disabled={!editable || toggleTool.isPending} onCheckedChange={(enabled) => toggleTool.mutate({ name: tool.name, enabled })} label={tool.label} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Configurações avançadas"
            description="Modelo, limites e orçamento da IA."
            action={<Button variant="ghost" size="sm" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? 'Ocultar' : 'Mostrar'}</Button>}
          />
          {showAdvanced ? (
            <CardContent className="grid gap-5 md:grid-cols-3">
              <Field label="Modelo" hint={`Padrão da plataforma: ${settings.data.defaultModel}`}>
                {(id) => (
                  <Select id={id} value={draft.model ?? ''} disabled={!editable} onChange={(event) => set('model', event.target.value || null)}>
                    <option value="">Padrão da plataforma</option>
                    {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Nível de raciocínio">
                {(id) => (
                  <Select id={id} value={draft.effort} disabled={!editable} onChange={(event) => set('effort', event.target.value)}>
                    {Object.entries(effortLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Máx. de tokens por resposta">{(id) => <Input id={id} type="number" min={256} max={16000} value={draft.maxOutputTokens} disabled={!editable} onChange={(event) => set('maxOutputTokens', Number(event.target.value))} />}</Field>
              <Field label="Máx. de ações por resposta">{(id) => <Input id={id} type="number" min={1} max={12} value={draft.maxToolIterations} disabled={!editable} onChange={(event) => set('maxToolIterations', Number(event.target.value))} />}</Field>
              <Field label="Mensagens de histórico">{(id) => <Input id={id} type="number" min={4} max={100} value={draft.historyMessageLimit} disabled={!editable} onChange={(event) => set('historyMessageLimit', Number(event.target.value))} />}</Field>
              <Field label="Resumir após (mensagens)">{(id) => <Input id={id} type="number" min={10} max={500} value={draft.summaryThreshold} disabled={!editable} onChange={(event) => set('summaryThreshold', Number(event.target.value))} />}</Field>
              <Field label="Orçamento diário (US$)" hint="Vazio = sem limite próprio.">
                {(id) => <Input id={id} type="number" min={0} step="0.5" value={draft.dailyBudgetUsd ?? ''} disabled={!editable} onChange={(event) => set('dailyBudgetUsd', event.target.value === '' ? null : Number(event.target.value))} />}
              </Field>
              <Field label="Orçamento mensal (US$)">
                {(id) => <Input id={id} type="number" min={0} step="1" value={draft.monthlyBudgetUsd ?? ''} disabled={!editable} onChange={(event) => set('monthlyBudgetUsd', event.target.value === '' ? null : Number(event.target.value))} />}
              </Field>
            </CardContent>
          ) : null}
        </Card>
      </div>

      <PromptPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Desativar a IA da empresa?"
        description="O atendente virtual deixará de responder TODAS as conversas imediatamente. As mensagens continuam chegando no painel para a equipe."
        confirmLabel="Desativar IA"
        loading={emergency.isPending}
        onConfirm={() => emergency.mutate()}
      />
    </PageContainer>
  );
}
