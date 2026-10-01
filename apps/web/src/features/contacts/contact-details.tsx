'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, ExternalLink, Mail, Phone, StickyNote, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ColorTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/form';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatPhone } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { Contact, CustomField, LeadStage, Tag } from '../types';

interface Note {
  id: string;
  body: string;
  createdAt: string;
  authorType: string;
  author: { id: string; name: string } | null;
}
interface Memory {
  id: string;
  key: string;
  value: string;
  source: string;
  updatedAt: string;
}

const MEMORY_LABELS: Record<string, string> = {
  preferred_name: 'Como prefere ser chamado',
  preferences: 'Preferências',
  service_interest: 'Interesse',
  last_purchase: 'Última compra',
  last_visit: 'Última visita',
  observation: 'Observação',
};

function Section({ title, icon: Icon, children, action }: { title: string; icon: typeof Brain; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Icon className="h-3.5 w-3.5" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ContactDetails({ contactId, lead }: { contactId: string; lead?: { id: string; stage: { id: string } } | null }) {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [note, setNote] = useState('');
  const [memoryKey, setMemoryKey] = useState('preferences');
  const [memoryValue, setMemoryValue] = useState('');

  const contact = useQuery({ queryKey: ['contact', contactId], queryFn: () => api.get<Contact>(`/app/contacts/${contactId}`) });
  const notes = useQuery({ queryKey: ['notes', contactId], queryFn: () => api.get<Note[]>(`/app/contacts/${contactId}/notes`) });
  const memories = useQuery({ queryKey: ['memories', contactId], queryFn: () => api.get<Memory[]>(`/app/contacts/${contactId}/memories`) });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/app/crm/tags') });
  const stages = useQuery({ queryKey: ['stages'], queryFn: () => api.get<LeadStage[]>('/app/crm/stages'), enabled: Boolean(lead) && can('crm:read') });
  const fields = useQuery({ queryKey: ['custom-fields'], queryFn: () => api.get<CustomField[]>('/app/crm/fields') });

  const invalidate = (key: string) => void client.invalidateQueries({ queryKey: [key, contactId] });
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const addNote = useMutation({ mutationFn: () => api.post(`/app/contacts/${contactId}/notes`, { body: note }), onSuccess: () => { setNote(''); invalidate('notes'); }, onError });
  const removeNote = useMutation({ mutationFn: (id: string) => api.delete(`/app/contacts/${contactId}/notes/${id}`), onSuccess: () => invalidate('notes'), onError });
  const saveMemory = useMutation({ mutationFn: () => api.put(`/app/contacts/${contactId}/memories`, { key: memoryKey, value: memoryValue }), onSuccess: () => { setMemoryValue(''); invalidate('memories'); }, onError });
  const removeMemory = useMutation({ mutationFn: (id: string) => api.delete(`/app/contacts/${contactId}/memories/${id}`), onSuccess: () => invalidate('memories'), onError });
  const setTags = useMutation({ mutationFn: (tagIds: string[]) => api.put(`/app/contacts/${contactId}/tags`, { tagIds }), onSuccess: () => { invalidate('contact'); void client.invalidateQueries({ queryKey: ['conversations'] }); }, onError });
  const moveLead = useMutation({
    mutationFn: (stageId: string) => api.post(`/app/crm/leads/${lead?.id}/move`, { stageId }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['conversation'] }); void client.invalidateQueries({ queryKey: ['leads'] }); toast.success('Etapa atualizada.'); },
    onError,
  });

  if (contact.isLoading || !contact.data) return <div className="space-y-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-24" /></div>;
  const data = contact.data;
  const contactFields = (fields.data ?? []).filter((field) => field.target === 'CONTACT');
  const tagIds = data.tags.map((tag) => tag.id);

  return (
    <div className="text-sm">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <Avatar name={data.name ?? data.phone} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{data.name ?? 'Sem nome'}</p>
          <p className="flex items-center gap-1 text-xs text-muted"><Phone className="h-3 w-3" /> {formatPhone(data.phone)}</p>
          {data.email ? <p className="flex items-center gap-1 truncate text-xs text-muted"><Mail className="h-3 w-3" /> {data.email}</p> : null}
        </div>
        <Link href={`/app/contacts/${contactId}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Abrir contato">
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      <Section title="Etiquetas" icon={StickyNote}>
        <div className="flex flex-wrap gap-1.5">
          {(tags.data ?? []).map((tag) => {
            const active = tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                disabled={!can('contacts:write')}
                onClick={() => setTags.mutate(active ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id])}
                className={active ? '' : 'opacity-40 hover:opacity-80'}
                aria-pressed={active}
              >
                <ColorTag name={tag.name} color={tag.color} />
              </button>
            );
          })}
          {tags.data?.length === 0 ? <p className="text-xs text-muted">Crie etiquetas em CRM.</p> : null}
        </div>
      </Section>

      {lead && stages.data ? (
        <Section title="Funil" icon={StickyNote}>
          <Select value={lead.stage.id} onChange={(event) => moveLead.mutate(event.target.value)} disabled={!can('crm:write')} aria-label="Etapa do funil">
            {stages.data.map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.name}</option>
            ))}
          </Select>
        </Section>
      ) : null}

      {contactFields.length > 0 ? (
        <Section title="Informações" icon={StickyNote}>
          <dl className="space-y-1.5">
            {contactFields.map((field) => (
              <div key={field.id} className="flex justify-between gap-3 text-xs">
                <dt className="text-muted">{field.label}</dt>
                <dd className="text-right font-medium text-slate-700">{String(data.customFields[field.key] ?? '—')}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <Section title="Memória do cliente" icon={Brain}>
        <p className="mb-2 text-[11px] text-muted">Informações úteis que a IA lembra em conversas futuras. Não guarde dados sensíveis.</p>
        <ul className="space-y-1.5">
          {(memories.data ?? []).map((memory) => (
            <li key={memory.id} className="group flex items-start gap-2 rounded-md bg-surface-muted px-2 py-1.5 text-xs">
              <div className="flex-1">
                <span className="font-medium text-slate-700">{MEMORY_LABELS[memory.key] ?? memory.key}:</span> {memory.value}
                <span className="ml-1 text-[10px] text-slate-400">({memory.source === 'AI' ? 'IA' : 'equipe'})</span>
              </div>
              {can('contacts:write') ? (
                <button onClick={() => removeMemory.mutate(memory.id)} className="text-slate-300 hover:text-red-600" aria-label="Excluir memória"><Trash2 className="h-3.5 w-3.5" /></button>
              ) : null}
            </li>
          ))}
        </ul>
        {can('contacts:write') ? (
          <div className="mt-2 space-y-1.5">
            <Select value={memoryKey} onChange={(event) => setMemoryKey(event.target.value)} className="text-xs" aria-label="Tipo de memória">
              {Object.entries(MEMORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
            <div className="flex gap-1.5">
              <Input value={memoryValue} onChange={(event) => setMemoryValue(event.target.value)} placeholder="Ex.: prefere horários pela manhã" className="text-xs" aria-label="Valor da memória" />
              <Button size="sm" variant="secondary" disabled={!memoryValue.trim()} onClick={() => saveMemory.mutate()}>Salvar</Button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Notas internas" icon={StickyNote}>
        {can('contacts:write') ? (
          <div className="mb-3 space-y-2">
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Registrar observação para a equipe" className="min-h-[64px] text-xs" aria-label="Nova nota" />
            <Button size="sm" variant="secondary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>Adicionar nota</Button>
          </div>
        ) : null}
        <ul className="space-y-2">
          {(notes.data ?? []).map((item) => (
            <li key={item.id} className="group rounded-md border border-border px-2.5 py-2 text-xs">
              <p className="whitespace-pre-wrap text-slate-700">{item.body}</p>
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                <span>{item.author?.name ?? (item.authorType === 'AI' ? 'IA' : 'Sistema')} · {formatDateTime(item.createdAt)}</span>
                {can('contacts:write') ? <button onClick={() => removeNote.mutate(item.id)} className="opacity-0 hover:text-red-600 group-hover:opacity-100" aria-label="Excluir nota"><Trash2 className="h-3 w-3" /></button> : null}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
