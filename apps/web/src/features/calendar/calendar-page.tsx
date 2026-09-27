'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { useMemo, useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { appointmentStatusLabels } from '@/i18n/pt-BR';
import { api, errorMessage, type Paginated } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPhone } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { Contact } from '../types';

interface Appointment {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: string;
  notes: string | null;
  createdByType: string;
  contact: { id: string; name: string | null; phone: string };
  service: { id: string; name: string; durationMinutes: number | null } | null;
}

const STATUS_TONE: Record<string, BadgeTone> = { PENDING: 'amber', CONFIRMED: 'brand', CANCELLED: 'red', COMPLETED: 'blue', NO_SHOW: 'neutral' };

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function useCompanyTimezone() {
  const company = useQuery({ queryKey: ['company'], queryFn: () => api.get<{ timezone: string }>('/app/company') });
  return company.data?.timezone ?? 'America/Sao_Paulo';
}

function NewAppointmentDialog({ open, onOpenChange, timezone }: { open: boolean; onOpenChange: (open: boolean) => void; timezone: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const [contactSearch, setContactSearch] = useState('');
  const [contactId, setContactId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slot, setSlot] = useState('');
  const [notes, setNotes] = useState('');
  const contacts = useQuery({ queryKey: ['contacts-picker', contactSearch], queryFn: () => api.get<Paginated<Contact>>('/app/contacts', { search: contactSearch, pageSize: 10 }), enabled: open });
  const services = useQuery({ queryKey: ['services-picker'], queryFn: () => api.get<Paginated<{ id: string; name: string; durationMinutes: number | null }>>('/app/catalog/services', { active: 'true', pageSize: 100 }), enabled: open });
  const availability = useQuery({
    queryKey: ['availability', date, serviceId],
    queryFn: () => api.get<{ slots: { start: string; end: string }[] }>('/app/calendar/availability', { date, serviceId }),
    enabled: open && Boolean(date),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => api.post('/app/calendar/appointments', { contactId, serviceId: serviceId || null, startAt: slot, notes: notes || null }),
    onSuccess: () => {
      toast.success('Agendamento criado.');
      void client.invalidateQueries({ queryKey: ['appointments'] });
      onOpenChange(false);
      setSlot('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const time = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Novo agendamento" size="lg" footer={<Button onClick={() => create.mutate()} disabled={!contactId || !slot} loading={create.isPending}>Agendar</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Buscar cliente">{(id) => <Input id={id} value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Nome ou telefone" />}</Field>
        <Field label="Cliente">
          {(id) => (
            <Select id={id} value={contactId} onChange={(event) => setContactId(event.target.value)}>
              <option value="">Selecione…</option>
              {(contacts.data?.items ?? []).map((contact) => <option key={contact.id} value={contact.id}>{contact.name ?? formatPhone(contact.phone)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Serviço">
          {(id) => (
            <Select id={id} value={serviceId} onChange={(event) => { setServiceId(event.target.value); setSlot(''); }}>
              <option value="">Sem serviço (30 min)</option>
              {(services.data?.items ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}{service.durationMinutes ? ` · ${service.durationMinutes} min` : ''}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(event) => { setDate(event.target.value); setSlot(''); }} />}</Field>
        <div className="md:col-span-2">
          <p className="mb-2 text-sm font-medium text-slate-700">Horários livres ({timezone})</p>
          {availability.isError ? (
            <p className="text-sm text-red-600">{errorMessage(availability.error)}</p>
          ) : availability.isLoading ? (
            <Skeleton className="h-16" />
          ) : availability.data?.slots.length === 0 ? (
            <p className="text-sm text-muted">Sem horários livres nesta data.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availability.data?.slots.map((item) => (
                <button key={item.start} onClick={() => setSlot(item.start)} className={cn('rounded-lg border px-3 py-1.5 text-sm', slot === item.start ? 'border-brand-600 bg-brand-600 text-white' : 'border-border hover:border-brand-400')}>
                  {time(item.start)}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Observações" className="md:col-span-2">{(id) => <Textarea id={id} value={notes} onChange={(event) => setNotes(event.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

export function CalendarPage() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const timezone = useCompanyTimezone();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [creating, setCreating] = useState(false);
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 86_400_000), [weekStart]);
  const appointments = useQuery({
    queryKey: ['appointments', weekStart.toISOString()],
    queryFn: () => api.get<Appointment[]>('/app/calendar/appointments', { from: weekStart.toISOString(), to: weekEnd.toISOString() }),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/app/calendar/appointments/${id}/status`, { status }),
    onSuccess: () => { toast.success('Agendamento atualizado.'); void client.invalidateQueries({ queryKey: ['appointments'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const dayKey = (iso: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const days = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * 86_400_000 + 12 * 3600_000));
  const today = dayKey(new Date());
  const menuItem = 'cursor-pointer rounded-md px-2.5 py-1.5 text-sm outline-none hover:bg-slate-100 focus:bg-slate-100';

  return (
    <PageContainer className="max-w-none">
      <PageHeader
        title="Agenda"
        description={`Horários exibidos no fuso da empresa (${timezone}).`}
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-white">
              <Button variant="ghost" size="icon" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86_400_000))} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <button className="px-2 text-sm font-medium" onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoje</button>
              <Button variant="ghost" size="icon" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86_400_000))} aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></Button>
            </div>
            {can('calendar:write') ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo agendamento</Button> : null}
          </>
        }
      />
      {appointments.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((day) => {
            const key = dayKey(day);
            const items = (appointments.data ?? []).filter((item) => dayKey(item.startAt) === key);
            return (
              <Card key={key} className={cn('min-h-40 p-2', key === today && 'ring-2 ring-brand-300')}>
                <p className="mb-2 px-1 text-xs font-semibold uppercase text-muted">
                  {new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: timezone }).format(day)}
                </p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <DropdownMenu.Root key={item.id}>
                      <DropdownMenu.Trigger className={cn('w-full rounded-lg border-l-4 bg-surface-muted p-2 text-left text-xs hover:bg-slate-100', item.status === 'CANCELLED' ? 'border-red-300 opacity-60' : item.status === 'PENDING' ? 'border-amber-400' : 'border-brand-500')}>
                        <p className="font-semibold text-slate-800">{time(item.startAt)}–{time(item.endAt)}</p>
                        <p className="truncate text-slate-700">{item.contact.name ?? formatPhone(item.contact.phone)}</p>
                        {item.service ? <p className="truncate text-muted">{item.service.name}</p> : null}
                        <Badge tone={STATUS_TONE[item.status] ?? 'neutral'} className="mt-1">{appointmentStatusLabels[item.status]}</Badge>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content sideOffset={4} className="z-50 w-56 rounded-xl border border-border bg-white p-1.5 shadow-xl">
                          <DropdownMenu.Item asChild className={menuItem}><Link href={`/app/contacts/${item.contact.id}`}>Abrir contato</Link></DropdownMenu.Item>
                          {can('calendar:write') && item.status !== 'CANCELLED' ? (
                            <>
                              {item.status === 'PENDING' ? <DropdownMenu.Item className={menuItem} onSelect={() => setStatus.mutate({ id: item.id, status: 'CONFIRMED' })}>Confirmar</DropdownMenu.Item> : null}
                              <DropdownMenu.Item className={menuItem} onSelect={() => setStatus.mutate({ id: item.id, status: 'COMPLETED' })}>Marcar como concluído</DropdownMenu.Item>
                              <DropdownMenu.Item className={menuItem} onSelect={() => setStatus.mutate({ id: item.id, status: 'NO_SHOW' })}>Não compareceu</DropdownMenu.Item>
                              <DropdownMenu.Item className={cn(menuItem, 'text-red-600')} onSelect={() => setStatus.mutate({ id: item.id, status: 'CANCELLED' })}>Cancelar</DropdownMenu.Item>
                            </>
                          ) : null}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  ))}
                  {items.length === 0 ? <p className="px-1 text-xs text-slate-400">Livre</p> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {appointments.data?.length === 0 ? <EmptyState icon={CalendarDays} title="Nenhum agendamento nesta semana" description="Agendamentos feitos pela IA ou pela equipe aparecem aqui." /> : null}
      <NewAppointmentDialog open={creating} onOpenChange={setCreating} timezone={timezone} />
    </PageContainer>
  );
}
