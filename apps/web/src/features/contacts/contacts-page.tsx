'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Contact as ContactIcon, Download, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { ColorTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Avatar, EmptyState, PageHeader, Pagination, Skeleton, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { formatPhone, formatRelative } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { Contact, Tag } from '../types';

function NewContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const create = useMutation({
    mutationFn: () => api.post<Contact>('/app/contacts', { name: form.name || null, phone: form.phone, email: form.email || null }),
    onSuccess: (contact) => {
      toast.success('Contato criado.');
      void client.invalidateQueries({ queryKey: ['contacts'] });
      onOpenChange(false);
      setForm({ name: '', phone: '', email: '' });
      router.push(`/app/contacts/${contact.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Novo contato" footer={<Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.phone.length < 8}>Criar contato</Button>}>
      <div className="space-y-4">
        <Field label="Nome">{(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <Field label="WhatsApp" hint="Com DDD. Ex.: (11) 98888-7777">{(id) => <Input id={id} value={form.phone} inputMode="tel" onChange={(event) => setForm({ ...form, phone: event.target.value })} />}</Field>
        <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function ContactsPage() {
  const can = useCan();
  const [search, setSearch] = useState('');
  const [tagId, setTagId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const contacts = useQuery({
    queryKey: ['contacts', search, tagId, page],
    queryFn: () => api.get<Paginated<Contact>>('/app/contacts', { search, tagId, page, pageSize: 25 }),
  });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/app/crm/tags') });

  return (
    <PageContainer>
      <PageHeader
        title="Contatos"
        description="Clientes que conversaram com a empresa ou foram cadastrados pela equipe."
        actions={
          <>
            {can('contacts:export') ? <Button variant="secondary" asChild><a href="/api/app/exports/contacts.csv"><Download className="h-4 w-4" /> Exportar CSV</a></Button> : null}
            {can('contacts:write') ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo contato</Button> : null}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por nome, telefone ou e-mail" className="pl-9" aria-label="Buscar contatos" />
          </div>
          <Select value={tagId} onChange={(event) => { setTagId(event.target.value); setPage(1); }} className="sm:w-56" aria-label="Filtrar por etiqueta">
            <option value="">Todas as etiquetas</option>
            {(tags.data ?? []).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </Select>
        </div>
        {contacts.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-10" />)}</div>
        ) : !contacts.data || contacts.data.items.length === 0 ? (
          <EmptyState icon={ContactIcon} title="Nenhum contato encontrado" description="Os contatos são criados automaticamente quando um cliente envia mensagem no WhatsApp." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Contato</Th>
                  <Th>Etiquetas</Th>
                  <Th>Responsável</Th>
                  <Th>Origem</Th>
                  <Th className="text-right">Última interação</Th>
                </tr>
              </thead>
              <tbody>
                {contacts.data.items.map((contact) => (
                  <tr key={contact.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/app/contacts/${contact.id}`} className="flex items-center gap-3">
                        <Avatar name={contact.name ?? contact.phone} className="h-8 w-8" />
                        <span>
                          <span className="block font-medium text-slate-900">{contact.name ?? 'Sem nome'}</span>
                          <span className="block text-xs text-muted">{formatPhone(contact.phone)}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td><div className="flex flex-wrap gap-1">{contact.tags.map((tag) => <ColorTag key={tag.id} name={tag.name} color={tag.color} />)}</div></Td>
                    <Td>{contact.assignee?.name ?? '—'}</Td>
                    <Td className="capitalize">{contact.source ?? '—'}</Td>
                    <Td className="text-right text-muted">{formatRelative(contact.lastInteractionAt) || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={contacts.data.page} pageSize={contacts.data.pageSize} total={contacts.data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
      <NewContactDialog open={creating} onOpenChange={setCreating} />
    </PageContainer>
  );
}
