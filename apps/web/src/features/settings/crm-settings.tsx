'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ColorTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import type { CustomField, Tag } from '../types';

const TYPE_LABELS = { TEXT: 'Texto', NUMBER: 'Número', SELECT: 'Lista de opções', BOOLEAN: 'Sim/Não', DATE: 'Data' } as const;

export function CrmSettings({ editable }: { editable: boolean }) {
  const client = useQueryClient();
  const toast = useToast();
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/app/crm/tags') });
  const fields = useQuery({ queryKey: ['custom-fields'], queryFn: () => api.get<CustomField[]>('/app/crm/fields') });
  const [tag, setTag] = useState({ name: '', color: '#0ea5e9' });
  const [field, setField] = useState({ target: 'LEAD', key: '', label: '', type: 'TEXT', options: '', collectByAgent: true, agentHint: '' });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const addTag = useMutation({ mutationFn: () => api.post('/app/crm/tags', { name: tag.name.toUpperCase().replace(/\s+/g, '_'), color: tag.color }), onSuccess: () => { setTag({ ...tag, name: '' }); void client.invalidateQueries({ queryKey: ['tags'] }); }, onError });
  const removeTag = useMutation({ mutationFn: (id: string) => api.delete(`/app/crm/tags/${id}`), onSuccess: () => client.invalidateQueries({ queryKey: ['tags'] }), onError });
  const addField = useMutation({
    mutationFn: () => api.post('/app/crm/fields', { ...field, options: field.type === 'SELECT' ? field.options.split(',').map((option) => option.trim()).filter(Boolean) : [], agentHint: field.agentHint || null }),
    onSuccess: () => { setField({ ...field, key: '', label: '', options: '', agentHint: '' }); void client.invalidateQueries({ queryKey: ['custom-fields'] }); },
    onError,
  });
  const updateField = useMutation({ mutationFn: ({ id, collectByAgent }: { id: string; collectByAgent: boolean }) => api.patch(`/app/crm/fields/${id}`, { collectByAgent }), onSuccess: () => client.invalidateQueries({ queryKey: ['custom-fields'] }), onError });
  const removeField = useMutation({ mutationFn: (id: string) => api.delete(`/app/crm/fields/${id}`), onSuccess: () => client.invalidateQueries({ queryKey: ['custom-fields'] }), onError });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Etiquetas" description="Classifique contatos (ex.: VIP, URGENTE, INTERESSADO_BOTOX)." />
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(tags.data ?? []).map((item) => (
              <span key={item.id} className="flex items-center gap-1">
                <ColorTag name={item.name} color={item.color} />
                {editable ? <button onClick={() => removeTag.mutate(item.id)} aria-label={`Remover ${item.name}`}><Trash2 className="h-3 w-3 text-slate-300 hover:text-red-600" /></button> : null}
              </span>
            ))}
          </div>
          {editable ? (
            <div className="flex gap-2">
              <input type="color" value={tag.color} onChange={(event) => setTag({ ...tag, color: event.target.value })} className="h-9 w-10 cursor-pointer rounded border border-border" aria-label="Cor" />
              <Input value={tag.name} onChange={(event) => setTag({ ...tag, name: event.target.value })} placeholder="NOVA_ETIQUETA" className="max-w-xs" aria-label="Nome da etiqueta" />
              <Button variant="secondary" onClick={() => addTag.mutate()} disabled={!tag.name.trim()}><Plus className="h-4 w-4" /> Criar</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Campos personalizados e qualificação" description="Informações extras do contato ou do lead. Marque para a IA coletar naturalmente durante a conversa." />
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {(fields.data ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-medium">{item.label}</span>
                <span className="font-mono text-xs text-muted">{item.key}</span>
                <span className="text-xs text-muted">{item.target === 'LEAD' ? 'Lead' : 'Contato'} · {TYPE_LABELS[item.type]}{item.options.length ? `: ${item.options.join(', ')}` : ''}</span>
                <span className="ml-auto flex items-center gap-2 text-xs text-muted">
                  <Bot className="h-3.5 w-3.5" /> IA coleta
                  <Switch checked={item.collectByAgent} disabled={!editable} onCheckedChange={(value) => updateField.mutate({ id: item.id, collectByAgent: value })} label="IA coleta" />
                  {editable ? <button onClick={() => removeField.mutate(item.id)} aria-label="Remover campo"><Trash2 className="h-4 w-4 text-slate-300 hover:text-red-600" /></button> : null}
                </span>
              </li>
            ))}
          </ul>
          {editable ? (
            <div className="grid gap-3 rounded-lg bg-surface-muted p-3 md:grid-cols-6">
              <Field label="Para">{(id) => <Select id={id} value={field.target} onChange={(event) => setField({ ...field, target: event.target.value })}><option value="LEAD">Lead</option><option value="CONTACT">Contato</option></Select>}</Field>
              <Field label="Nome do campo" className="md:col-span-2">{(id) => <Input id={id} value={field.label} onChange={(event) => setField({ ...field, label: event.target.value, key: event.target.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })} />}</Field>
              <Field label="Tipo">{(id) => <Select id={id} value={field.type} onChange={(event) => setField({ ...field, type: event.target.value })}>{Object.entries(TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>}</Field>
              <Field label="Opções" hint="Separadas por vírgula" className="md:col-span-2">{(id) => <Input id={id} value={field.options} disabled={field.type !== 'SELECT'} onChange={(event) => setField({ ...field, options: event.target.value })} />}</Field>
              <Field label="Dica para a IA" className="md:col-span-5">{(id) => <Input id={id} value={field.agentHint} onChange={(event) => setField({ ...field, agentHint: event.target.value })} placeholder="Ex.: faixa de valor que o cliente pode pagar" />}</Field>
              <div className="flex items-end"><Button className="w-full" onClick={() => addField.mutate()} disabled={field.label.length < 2 || field.key.length < 2}>Adicionar</Button></div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
