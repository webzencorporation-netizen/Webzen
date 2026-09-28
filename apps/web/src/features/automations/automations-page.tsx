'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, PageHeader, Skeleton, Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { automationTriggerLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

type Action =
  | { type: 'add_tag'; tagName: string }
  | { type: 'notify_team'; title: string; body?: string }
  | { type: 'send_template'; templateName: string; languageCode: string; bodyParameters: string[] }
  | { type: 'send_message'; text: string }
  | { type: 'move_lead_stage'; stageKey: string }
  | { type: 'create_note'; text: string };

interface Automation {
  id: string;
  name: string;
  trigger: string;
  conditions: { field: string; op: string; value?: string }[];
  actions: Action[];
  isActive: boolean;
  runCount: number;
  lastRunAt: string | null;
}

const ACTION_LABELS: Record<Action['type'], string> = {
  add_tag: 'Adicionar etiqueta',
  notify_team: 'Notificar equipe',
  send_template: 'Enviar template do WhatsApp',
  send_message: 'Enviar mensagem (janela de 24h aberta)',
  move_lead_stage: 'Mover lead de etapa',
  create_note: 'Registrar nota no contato',
};

function describeAction(action: Action): string {
  switch (action.type) {
    case 'add_tag': return `Etiqueta ${action.tagName}`;
    case 'notify_team': return `Notificar: ${action.title}`;
    case 'send_template': return `Template ${action.templateName}`;
    case 'send_message': return `Mensagem: ${action.text.slice(0, 40)}`;
    case 'move_lead_stage': return `Mover para ${action.stageKey}`;
    case 'create_note': return 'Registrar nota';
  }
}

function NewAutomationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('contact.created');
  const [type, setType] = useState<Action['type']>('add_tag');
  const [value, setValue] = useState('');
  const [extra, setExtra] = useState('pt_BR');
  const buildAction = (): Action => {
    switch (type) {
      case 'add_tag': return { type, tagName: value.toUpperCase().replace(/\s+/g, '_') };
      case 'notify_team': return { type, title: value };
      case 'send_template': return { type, templateName: value, languageCode: extra, bodyParameters: ['{{contact.name}}'] };
      case 'send_message': return { type, text: value };
      case 'move_lead_stage': return { type, stageKey: value.toUpperCase() };
      case 'create_note': return { type, text: value };
    }
  };
  const create = useMutation({
    mutationFn: () => api.post('/app/automations', { name, trigger, actions: [buildAction()], conditions: [] }),
    onSuccess: () => { toast.success('Automação criada.'); void client.invalidateQueries({ queryKey: ['automations'] }); onOpenChange(false); setName(''); setValue(''); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nova automação" description="Quando algo acontecer, execute uma ação automaticamente." footer={<Button onClick={() => create.mutate()} disabled={name.length < 2 || !value} loading={create.isPending}>Criar</Button>}>
      <div className="space-y-4">
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Etiquetar novos contatos" />}</Field>
        <Field label="Quando">{(id) => <Select id={id} value={trigger} onChange={(event) => setTrigger(event.target.value)}>{Object.entries(automationTriggerLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}</Field>
        <Field label="Então">{(id) => <Select id={id} value={type} onChange={(event) => { setType(event.target.value as Action['type']); setValue(''); }}>{Object.entries(ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}</Field>
        <Field
          label={{ add_tag: 'Etiqueta', notify_team: 'Título da notificação', send_template: 'Nome do template aprovado', send_message: 'Texto (use {{contact.name}})', move_lead_stage: 'Chave da etapa (ex.: QUALIFICADO)', create_note: 'Texto da nota' }[type]}
          hint={type === 'send_template' ? 'O primeiro parâmetro do template recebe o nome do contato.' : undefined}
        >
          {(id) => <Input id={id} value={value} onChange={(event) => setValue(event.target.value)} />}
        </Field>
        {type === 'send_template' ? <Field label="Idioma do template">{(id) => <Input id={id} value={extra} onChange={(event) => setExtra(event.target.value)} />}</Field> : null}
      </div>
    </Dialog>
  );
}

export function AutomationsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const automations = useQuery({ queryKey: ['automations'], queryFn: () => api.get<Automation[]>('/app/automations') });
  const toggle = useMutation({ mutationFn: (item: Automation) => api.patch(`/app/automations/${item.id}`, { isActive: !item.isActive }), onSuccess: () => client.invalidateQueries({ queryKey: ['automations'] }), onError: (error) => toast.error(errorMessage(error)) });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/app/automations/${id}`), onSuccess: () => client.invalidateQueries({ queryKey: ['automations'] }) });
  const write = can('automations:write');
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Automações" description="Regras simples que reagem a eventos do atendimento." actions={write ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova automação</Button> : null} />
      <Card>
        {automations.isLoading ? <div className="p-4"><Skeleton className="h-32" /></div> : !automations.data?.length ? (
          <EmptyState icon={Workflow} title="Nenhuma automação" description="Ex.: quando surgir um novo lead, adicionar a etiqueta NOVO; um dia antes da consulta, enviar lembrete." />
        ) : (
          <ul className="divide-y divide-border">
            {automations.data.map((item) => (
              <li key={item.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    Quando <Badge tone="blue">{automationTriggerLabels[item.trigger] ?? item.trigger}</Badge> → {item.actions.map(describeAction).join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{item.runCount} execuções · última {formatDateTime(item.lastRunAt)}</p>
                </div>
                <Switch checked={item.isActive} disabled={!write} onCheckedChange={() => toggle.mutate(item)} label="Ativa" />
                {write ? <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(item.id)} aria-label="Excluir automação"><Trash2 className="h-4 w-4 text-red-500" /></Button> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NewAutomationDialog open={creating} onOpenChange={setCreating} />
    </PageContainer>
  );
}
