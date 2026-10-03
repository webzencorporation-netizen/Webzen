'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Contact as ContactIcon, Download, MessagesSquare, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatDateTime, formatPhone } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { Contact, ConversationListItem, CustomField } from '../types';
import { ContactDetails } from './contact-details';

export function ContactPage({ contactId }: { contactId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const can = useCan();
  const contact = useQuery({ queryKey: ['contact', contactId], queryFn: () => api.get<Contact>(`/app/contacts/${contactId}`) });
  const fields = useQuery({ queryKey: ['custom-fields'], queryFn: () => api.get<CustomField[]>('/app/crm/fields') });
  const conversations = useQuery({
    queryKey: ['contact-conversations', contactId, contact.data?.phone],
    queryFn: () => api.get<Paginated<ConversationListItem>>('/app/conversations', { filter: 'all', search: contact.data?.phone, pageSize: 5 }),
    enabled: Boolean(contact.data),
  });
  const [form, setForm] = useState<{ name: string; email: string; nextActionNote: string; nextActionAt: string; customFields: Record<string, unknown> } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (contact.data && !form) {
      setForm({
        name: contact.data.name ?? '',
        email: contact.data.email ?? '',
        nextActionNote: contact.data.nextActionNote ?? '',
        nextActionAt: contact.data.nextActionAt ? contact.data.nextActionAt.slice(0, 16) : '',
        customFields: contact.data.customFields ?? {},
      });
    }
  }, [contact.data, form]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/app/contacts/${contactId}`, {
        name: form?.name || null,
        email: form?.email || null,
        nextActionNote: form?.nextActionNote || null,
        nextActionAt: form?.nextActionAt ? new Date(form.nextActionAt).toISOString() : null,
        customFields: form?.customFields,
      }),
    onSuccess: () => { toast.success('Contato atualizado.'); void client.invalidateQueries({ queryKey: ['contact', contactId] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/app/contacts/${contactId}`),
    onSuccess: () => { toast.success('Contato e dados associados excluídos.'); void client.invalidateQueries({ queryKey: ['contacts'] }); router.replace('/app/contacts'); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (contact.isError) {
    return (
      <PageContainer>
        <EmptyState
          icon={ContactIcon}
          title="Contato não encontrado"
          description="Ele pode ter sido excluído ou não pertencer a esta empresa."
          action={<Button asChild variant="secondary"><Link href="/app/contacts"><ArrowLeft className="h-4 w-4" /> Voltar para contatos</Link></Button>}
        />
      </PageContainer>
    );
  }
  if (!contact.data || !form) return <PageContainer><Skeleton className="h-64" /></PageContainer>;
  const editable = can('contacts:write');
  const contactFields = (fields.data ?? []).filter((field) => field.target === 'CONTACT');

  return (
    <PageContainer>
      <PageHeader
        title={contact.data.name ?? formatPhone(contact.data.phone)}
        description={`${formatPhone(contact.data.phone)} · cliente desde ${formatDateTime(contact.data.createdAt)}`}
        actions={
          <>
            <Button variant="ghost" asChild><Link href="/app/contacts"><ArrowLeft className="h-4 w-4" /> Contatos</Link></Button>
            {can('contacts:export') ? <Button variant="secondary" asChild><a href={`/api/app/contacts/${contactId}/export`} download={`contato-${contactId}.json`}><Download className="h-4 w-4" /> Exportar dados</a></Button> : null}
            {can('contacts:delete') ? <Button variant="danger" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" /> Excluir</Button> : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Dados do contato" action={editable ? <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="h-4 w-4" /> Salvar</Button> : null} />
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Nome">{(id) => <Input id={id} value={form.name} disabled={!editable} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
              <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} disabled={!editable} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
              <Field label="Próxima ação">{(id) => <Input id={id} value={form.nextActionNote} disabled={!editable} placeholder="Ex.: ligar para confirmar orçamento" onChange={(event) => setForm({ ...form, nextActionNote: event.target.value })} />}</Field>
              <Field label="Data da próxima ação">{(id) => <Input id={id} type="datetime-local" value={form.nextActionAt} disabled={!editable} onChange={(event) => setForm({ ...form, nextActionAt: event.target.value })} />}</Field>
              {contactFields.map((field) => (
                <Field key={field.id} label={field.label}>
                  {(id) =>
                    field.type === 'SELECT' ? (
                      <Select id={id} value={String(form.customFields[field.key] ?? '')} disabled={!editable} onChange={(event) => setForm({ ...form, customFields: { ...form.customFields, [field.key]: event.target.value || null } })}>
                        <option value="">—</option>
                        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </Select>
                    ) : field.type === 'BOOLEAN' ? (
                      <Select id={id} value={form.customFields[field.key] === true ? 'true' : form.customFields[field.key] === false ? 'false' : ''} disabled={!editable} onChange={(event) => setForm({ ...form, customFields: { ...form.customFields, [field.key]: event.target.value === '' ? null : event.target.value === 'true' } })}>
                        <option value="">—</option><option value="true">Sim</option><option value="false">Não</option>
                      </Select>
                    ) : (
                      <Input id={id} type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'} value={String(form.customFields[field.key] ?? '')} disabled={!editable} onChange={(event) => setForm({ ...form, customFields: { ...form.customFields, [field.key]: event.target.value === '' ? null : field.type === 'NUMBER' ? Number(event.target.value) : event.target.value } })} />
                    )
                  }
                </Field>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Conversas" />
            <ul className="divide-y divide-border">
              {(conversations.data?.items ?? []).map((conversation) => (
                <li key={conversation.id}>
                  <Link href={`/app/conversations/${conversation.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <MessagesSquare className="h-4 w-4 text-slate-400" />
                    <span className="flex-1 truncate text-sm">{conversation.lastMessagePreview}</span>
                    <span className="text-xs text-muted">{formatDateTime(conversation.lastMessageAt)}</span>
                  </Link>
                </li>
              ))}
              {conversations.data?.items.length === 0 ? <li className="px-5 py-4 text-sm text-muted">Nenhuma conversa.</li> : null}
            </ul>
          </Card>
        </div>
        <Card className="h-fit overflow-hidden"><ContactDetails contactId={contactId} /></Card>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir contato definitivamente?"
        description="Serão excluídos o contato, suas conversas, mensagens, mídias, notas, memórias, leads e agendamentos. Esta ação não pode ser desfeita."
        confirmLabel="Excluir tudo"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </PageContainer>
  );
}
