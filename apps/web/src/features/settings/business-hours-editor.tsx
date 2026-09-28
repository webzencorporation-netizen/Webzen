'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { weekdayLabels } from '@/i18n/pt-BR';
import { api, errorMessage } from '@/lib/api';
import type { BusinessDay, CompanyProfile } from './types';

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function BusinessHoursEditor({ profile, editable, onSaved }: { profile: CompanyProfile; editable: boolean; onSaved?: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState<BusinessDay[]>(profile.businessHours);
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['company'] }); void client.invalidateQueries({ queryKey: ['onboarding'] }); };
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const save = useMutation({ mutationFn: () => api.put('/app/company/business-hours', { schedule: days }), onSuccess: () => { toast.success('Horários salvos.'); refresh(); onSaved?.(); }, onError });
  const addHoliday = useMutation({ mutationFn: () => api.put('/app/company/holidays', { ...holiday, closed: true }), onSuccess: () => { setHoliday({ date: '', name: '' }); refresh(); }, onError });
  const removeHoliday = useMutation({ mutationFn: (id: string) => api.delete(`/app/company/holidays/${id}`), onSuccess: refresh, onError });

  const setDay = (weekday: number, patch: Partial<BusinessDay> | null) =>
    setDays((current) => {
      const others = current.filter((day) => day.weekday !== weekday);
      if (patch === null) return others;
      const existing = current.find((day) => day.weekday === weekday) ?? { weekday, open: '09:00', close: '18:00', breaks: [] };
      return [...others, { ...existing, ...patch }].sort((a, b) => ORDER.indexOf(a.weekday) - ORDER.indexOf(b.weekday));
    });

  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {ORDER.map((weekday) => {
          const day = days.find((item) => item.weekday === weekday);
          return (
            <li key={weekday} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
              <div className="flex w-32 items-center gap-2">
                <Switch checked={Boolean(day)} disabled={!editable} onCheckedChange={(open) => setDay(weekday, open ? {} : null)} label={`Aberto ${weekdayLabels[weekday]}`} />
                <span className="text-sm font-medium">{weekdayLabels[weekday]}</span>
              </div>
              {day ? (
                <>
                  <Input type="time" value={day.open} disabled={!editable} onChange={(event) => setDay(weekday, { open: event.target.value })} className="w-28" aria-label="Abertura" />
                  <span className="text-sm text-muted">às</span>
                  <Input type="time" value={day.close} disabled={!editable} onChange={(event) => setDay(weekday, { close: event.target.value })} className="w-28" aria-label="Fechamento" />
                  {day.breaks.map((pause, index) => (
                    <span key={index} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs">
                      pausa
                      <input type="time" value={pause.start} disabled={!editable} className="bg-transparent" aria-label="Início da pausa" onChange={(event) => setDay(weekday, { breaks: day.breaks.map((item, position) => (position === index ? { ...item, start: event.target.value } : item)) })} />
                      –
                      <input type="time" value={pause.end} disabled={!editable} className="bg-transparent" aria-label="Fim da pausa" onChange={(event) => setDay(weekday, { breaks: day.breaks.map((item, position) => (position === index ? { ...item, end: event.target.value } : item)) })} />
                      {editable ? <button onClick={() => setDay(weekday, { breaks: day.breaks.filter((_, position) => position !== index) })} aria-label="Remover pausa"><Trash2 className="h-3 w-3 text-slate-400" /></button> : null}
                    </span>
                  ))}
                  {editable && day.breaks.length < 2 ? <Button variant="ghost" size="sm" onClick={() => setDay(weekday, { breaks: [...day.breaks, { start: '12:00', end: '13:00' }] })}><Plus className="h-3.5 w-3.5" /> Pausa</Button> : null}
                </>
              ) : <span className="text-sm text-muted">Fechado</span>}
            </li>
          );
        })}
      </ul>
      {editable ? <div className="flex justify-end"><Button onClick={() => save.mutate()} loading={save.isPending}>Salvar horários</Button></div> : null}
      <div>
        <p className="mb-2 text-sm font-semibold">Feriados e dias fechados</p>
        <ul className="mb-3 space-y-1.5">
          {profile.holidays.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm">
              <span>{item.date.split('-').reverse().join('/')} · {item.name}</span>
              {editable ? <button onClick={() => removeHoliday.mutate(item.id)} aria-label="Remover feriado"><Trash2 className="h-4 w-4 text-slate-400 hover:text-red-600" /></button> : null}
            </li>
          ))}
          {profile.holidays.length === 0 ? <li className="text-sm text-muted">Nenhum feriado cadastrado.</li> : null}
        </ul>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={holiday.date} onChange={(event) => setHoliday({ ...holiday, date: event.target.value })} className="w-44" aria-label="Data do feriado" />
            <Input value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} placeholder="Nome (ex.: Natal)" className="w-56" aria-label="Nome do feriado" />
            <Button variant="secondary" onClick={() => addHoliday.mutate()} disabled={!holiday.date || holiday.name.length < 2}>Adicionar</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
