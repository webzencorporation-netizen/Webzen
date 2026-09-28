'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Rocket, SkipForward } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { toneLabels } from '@/i18n/pt-BR';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { cn } from '@/lib/cn';
import { BusinessHoursEditor } from '../settings/business-hours-editor';
import { CompanyProfileForm } from '../settings/company-profile-form';
import type { CompanyProfile } from '../settings/types';
import type { AiSettings } from '../agent/types';

interface Onboarding {
  steps: { key: string; title: string; done: boolean; skipped: boolean }[];
  current: string;
  progress: number;
  finished: boolean;
}

const DESCRIPTIONS: Record<string, string> = {
  company: 'Nome, contato, endereço e uma descrição do negócio.',
  hours: 'Dias e horários de atendimento, pausas e feriados.',
  catalog: 'Serviços e produtos que o atendente pode apresentar.',
  faq: 'Perguntas frequentes com as respostas oficiais.',
  ai: 'Nome, tom e personalidade do atendente virtual.',
  whatsapp: 'Conecte o número pela API oficial da Meta.',
  integrations: 'Conecte a agenda (opcional).',
  test: 'Converse com o atendente antes de ativar.',
  activation: 'Revise e ative o atendimento automático.',
};

function CatalogStep({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const services = useQuery({ queryKey: ['catalog', 'services'], queryFn: () => api.get<Paginated<{ id: string; name: string }>>('/app/catalog/services', { pageSize: 50 }) });
  const [form, setForm] = useState({ name: '', price: '', duration: '30' });
  const add = useMutation({
    mutationFn: () => api.post('/app/catalog/services', { name: form.name, priceCents: form.price ? Math.round(Number(form.price.replace(',', '.')) * 100) : null, durationMinutes: Number(form.duration) || null }),
    onSuccess: () => { setForm({ name: '', price: '', duration: '30' }); void client.invalidateQueries({ queryKey: ['catalog'] }); onDone(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-2">{(services.data?.items ?? []).map((service) => <li key={service.id} className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-800">{service.name}</li>)}</ul>
      <div className="grid gap-3 md:grid-cols-[1fr_140px_140px_auto]">
        <Field label="Serviço">{(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <Field label="Preço (R$)">{(id) => <Input id={id} value={form.price} inputMode="decimal" onChange={(event) => setForm({ ...form, price: event.target.value })} />}</Field>
        <Field label="Duração (min)">{(id) => <Input id={id} type="number" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} />}</Field>
        <div className="flex items-end"><Button onClick={() => add.mutate()} disabled={form.name.length < 2} loading={add.isPending}>Adicionar</Button></div>
      </div>
      <Link href="/app/catalog" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">Abrir catálogo completo (produtos, estoque, atributos) <ExternalLink className="h-3.5 w-3.5" /></Link>
    </div>
  );
}

function FaqStep({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const template = useQuery({ queryKey: ['template'], queryFn: () => api.get<{ suggestedFaqs: { question: string }[] }>('/app/company/template') });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      for (const [question, answer] of Object.entries(answers)) {
        if (answer.trim()) await api.post('/app/knowledge/entries', { type: 'FAQ', title: question, content: answer.trim() });
      }
    },
    onSuccess: () => { toast.success('Perguntas salvas na base de conhecimento.'); setAnswers({}); onDone(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <div className="space-y-4">
      {(template.data?.suggestedFaqs ?? []).map((faq) => (
        <Field key={faq.question} label={faq.question}>{(id) => <Textarea id={id} value={answers[faq.question] ?? ''} onChange={(event) => setAnswers({ ...answers, [faq.question]: event.target.value })} placeholder="Resposta oficial da empresa" className="min-h-[64px]" />}</Field>
      ))}
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!Object.values(answers).some((value) => value.trim())}>Salvar respostas</Button>
        <Link href="/app/knowledge" className="text-sm text-brand-700 hover:underline">Adicionar mais na base de conhecimento</Link>
      </div>
    </div>
  );
}

function AiStep({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('/app/ai') });
  const [form, setForm] = useState<{ agentName: string; personality: string; tone: string; greetingMessage: string } | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm({ agentName: settings.data.config.agentName, personality: settings.data.config.personality ?? '', tone: settings.data.config.tone, greetingMessage: settings.data.config.greetingMessage ?? '' });
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: () => api.patch('/app/ai/config', { ...form, personality: form?.personality || null, greetingMessage: form?.greetingMessage || null }),
    onSuccess: () => { toast.success('Atendente configurado.'); void client.invalidateQueries({ queryKey: ['ai-settings'] }); onDone(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!form) return <Skeleton className="h-40" />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nome do atendente">{(id) => <Input id={id} value={form.agentName} onChange={(event) => setForm({ ...form, agentName: event.target.value })} />}</Field>
      <Field label="Tom">
        {(id) => <select id={id} className="h-9 w-full rounded-lg border border-border px-3 text-sm" value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })}>{Object.entries(toneLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
      </Field>
      <Field label="Personalidade" className="md:col-span-2">{(id) => <Input id={id} value={form.personality} placeholder="Ex.: acolhedora, paciente e objetiva" onChange={(event) => setForm({ ...form, personality: event.target.value })} />}</Field>
      <Field label="Mensagem inicial" className="md:col-span-2">{(id) => <Textarea id={id} value={form.greetingMessage} onChange={(event) => setForm({ ...form, greetingMessage: event.target.value })} />}</Field>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button onClick={() => save.mutate()} loading={save.isPending}>Salvar</Button>
        <Link href="/app/agent" className="text-sm text-brand-700 hover:underline">Regras, ferramentas e opções avançadas</Link>
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const client = useQueryClient();
  const toast = useToast();
  const onboarding = useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<Onboarding>('/app/company/onboarding') });
  const profile = useQuery({ queryKey: ['company'], queryFn: () => api.get<CompanyProfile>('/app/company') });
  const [current, setCurrent] = useState<string | null>(null);
  const progress = useMutation({
    mutationFn: (body: { step: string; action: 'complete' | 'skip'; current?: string }) => api.put<Onboarding>('/app/company/onboarding', body),
    onSuccess: (data) => client.setQueryData(['onboarding'], data),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const activate = useMutation({
    mutationFn: () => api.post<Onboarding>('/app/company/activate', { enableAi: true }),
    onSuccess: () => { toast.success('Atendimento ativado! 🎉'); void client.invalidateQueries(); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (onboarding.data && !current) setCurrent(onboarding.data.current);
  }, [onboarding.data, current]);

  if (!onboarding.data || !profile.data || !current) return <PageContainer><Skeleton className="h-96" /></PageContainer>;
  const steps = onboarding.data.steps;
  const index = steps.findIndex((step) => step.key === current);
  const step = steps[index] ?? steps[0]!;
  const go = (delta: number) => {
    const next = steps[index + delta];
    if (next) setCurrent(next.key);
  };
  const complete = () => {
    progress.mutate({ step: step.key, action: 'complete', current: steps[index + 1]?.key ?? step.key });
    go(1);
  };

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader title="Configuração da empresa" description="Siga as etapas no seu ritmo — o progresso fica salvo." />
      <div className="mb-6">
        <div className="mb-1 flex justify-between text-xs text-muted"><span>Progresso</span><span>{onboarding.data.progress}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${onboarding.data.progress}%` }} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <ol className="space-y-1">
          {steps.map((item, position) => (
            <li key={item.key}>
              <button onClick={() => setCurrent(item.key)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', item.key === current ? 'bg-white font-semibold shadow-sm ring-1 ring-border' : 'text-slate-600 hover:bg-white/60')}>
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs', item.done ? 'bg-brand-600 text-white' : item.skipped ? 'bg-slate-300 text-white' : 'bg-slate-200 text-slate-600')}>
                  {item.done ? <Check className="h-3.5 w-3.5" /> : position + 1}
                </span>
                {item.title}
                {item.skipped && !item.done ? <span className="ml-auto text-[10px] text-muted">pulada</span> : null}
              </button>
            </li>
          ))}
        </ol>
        <Card>
          <CardContent className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Etapa {index + 1} de {steps.length}</p>
              <h2 className="mt-1 text-lg font-semibold">{step.title}</h2>
              <p className="text-sm text-muted">{DESCRIPTIONS[step.key]}</p>
            </div>
            {step.key === 'company' ? <CompanyProfileForm profile={profile.data} editable onSaved={complete} /> : null}
            {step.key === 'hours' ? <BusinessHoursEditor profile={profile.data} editable onSaved={complete} /> : null}
            {step.key === 'catalog' ? <CatalogStep onDone={() => void client.invalidateQueries({ queryKey: ['onboarding'] })} /> : null}
            {step.key === 'faq' ? <FaqStep onDone={() => void client.invalidateQueries({ queryKey: ['onboarding'] })} /> : null}
            {step.key === 'ai' ? <AiStep onDone={complete} /> : null}
            {step.key === 'whatsapp' ? (
              <div className="space-y-3 text-sm text-slate-600">
                <p>A conexão usa a API oficial do WhatsApp (Meta). Nossa equipe pode fazer isso por você — ou você pode informar os dados do número em Integrações.</p>
                <Button variant="secondary" asChild><Link href="/app/integrations">Abrir Integrações <ExternalLink className="h-4 w-4" /></Link></Button>
              </div>
            ) : null}
            {step.key === 'integrations' ? (
              <div className="space-y-3 text-sm text-slate-600">
                <p>A agenda interna já funciona. Conectar o Google Agenda é opcional e evita conflitos com compromissos externos.</p>
                <Button variant="secondary" asChild><Link href="/app/integrations">Conectar Google Agenda <ExternalLink className="h-4 w-4" /></Link></Button>
              </div>
            ) : null}
            {step.key === 'test' ? (
              <div className="space-y-3 text-sm text-slate-600">
                <p>Converse com o atendente como se fosse um cliente. Nada é enviado ao WhatsApp. Esta etapa é concluída automaticamente após o primeiro teste.</p>
                <Button asChild><Link href="/app/agent/test">Testar agente</Link></Button>
              </div>
            ) : null}
            {step.key === 'activation' ? (
              <div className="space-y-4">
                <ul className="space-y-1.5 text-sm">
                  {steps.filter((item) => item.key !== 'activation').map((item) => (
                    <li key={item.key} className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', item.done ? 'bg-brand-500' : item.skipped ? 'bg-slate-300' : 'bg-amber-400')} />
                      {item.title}: <span className="text-muted">{item.done ? 'concluído' : item.skipped ? 'pulado' : 'pendente'}</span>
                    </li>
                  ))}
                </ul>
                <Button size="lg" onClick={() => activate.mutate()} loading={activate.isPending}><Rocket className="h-4 w-4" /> Ativar atendimento</Button>
                <p className="text-xs text-muted">Ao ativar, o atendente virtual passa a responder as mensagens recebidas no WhatsApp. Você pode pausá-lo a qualquer momento.</p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => go(-1)} disabled={index === 0}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
              <div className="flex gap-2">
                {step.key !== 'activation' ? (
                  <>
                    <Button variant="ghost" onClick={() => { progress.mutate({ step: step.key, action: 'skip', current: steps[index + 1]?.key }); go(1); }}><SkipForward className="h-4 w-4" /> Pular</Button>
                    <Button variant="secondary" onClick={complete}>Concluir etapa <ChevronRight className="h-4 w-4" /></Button>
                  </>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
