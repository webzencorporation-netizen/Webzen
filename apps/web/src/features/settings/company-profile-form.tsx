'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import type { CompanyProfile } from './types';

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Cuiaba', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'UTC'];

export function CompanyProfileForm({ profile, editable, onSaved }: { profile: CompanyProfile; editable: boolean; onSaved?: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: profile.name,
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    website: profile.website ?? '',
    description: profile.description ?? '',
    timezone: profile.timezone,
    address: { street: '', number: '', complement: '', district: '', city: '', state: '', zip: '', mapsUrl: '', ...(profile.address ?? {}) },
  });
  const save = useMutation({
    mutationFn: () => api.patch('/app/company', { ...form, email: form.email || null, website: form.website || null }),
    onSuccess: () => { toast.success('Dados da empresa salvos.'); void client.invalidateQueries({ queryKey: ['company'] }); void client.invalidateQueries({ queryKey: ['onboarding'] }); onSaved?.(); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const address = (key: keyof typeof form.address, value: string) => setForm({ ...form, address: { ...form.address, [key]: value } });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome da empresa">{(id) => <Input id={id} value={form.name} disabled={!editable} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <Field label="Segmento">{(id) => <Input id={id} value={profile.templateName} disabled />}</Field>
        <Field label="Telefone">{(id) => <Input id={id} value={form.phone} disabled={!editable} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}</Field>
        <Field label="E-mail">{(id) => <Input id={id} type="email" value={form.email} disabled={!editable} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
        <Field label="Site">{(id) => <Input id={id} value={form.website} disabled={!editable} placeholder="https://" onChange={(event) => setForm({ ...form, website: event.target.value })} />}</Field>
        <Field label="Fuso horário" hint="Usado na agenda e nos horários de funcionamento.">
          {(id) => <Select id={id} value={form.timezone} disabled={!editable} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>}
        </Field>
        <Field label="Descrição" className="md:col-span-2" hint="O que a empresa faz — o atendente usa este texto para se apresentar.">
          {(id) => <Textarea id={id} value={form.description} disabled={!editable} onChange={(event) => setForm({ ...form, description: event.target.value })} />}
        </Field>
      </div>
      <div>
        <p className="mb-3 text-sm font-semibold">Endereço</p>
        <div className="grid gap-4 md:grid-cols-6">
          <Field label="Rua" className="md:col-span-3">{(id) => <Input id={id} value={form.address.street} disabled={!editable} onChange={(event) => address('street', event.target.value)} />}</Field>
          <Field label="Número">{(id) => <Input id={id} value={form.address.number} disabled={!editable} onChange={(event) => address('number', event.target.value)} />}</Field>
          <Field label="Complemento" className="md:col-span-2">{(id) => <Input id={id} value={form.address.complement} disabled={!editable} onChange={(event) => address('complement', event.target.value)} />}</Field>
          <Field label="Bairro" className="md:col-span-2">{(id) => <Input id={id} value={form.address.district} disabled={!editable} onChange={(event) => address('district', event.target.value)} />}</Field>
          <Field label="Cidade" className="md:col-span-2">{(id) => <Input id={id} value={form.address.city} disabled={!editable} onChange={(event) => address('city', event.target.value)} />}</Field>
          <Field label="UF">{(id) => <Input id={id} value={form.address.state} maxLength={2} disabled={!editable} onChange={(event) => address('state', event.target.value.toUpperCase())} />}</Field>
          <Field label="CEP">{(id) => <Input id={id} value={form.address.zip} disabled={!editable} onChange={(event) => address('zip', event.target.value)} />}</Field>
          <Field label="Link do mapa" className="md:col-span-6">{(id) => <Input id={id} value={form.address.mapsUrl} disabled={!editable} placeholder="https://maps.google.com/…" onChange={(event) => address('mapsUrl', event.target.value)} />}</Field>
        </div>
      </div>
      {editable ? <div className="flex justify-end"><Button onClick={() => save.mutate()} loading={save.isPending}>Salvar dados</Button></div> : null}
    </div>
  );
}
