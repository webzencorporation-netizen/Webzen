'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import type { LeadStage } from '../types';

export function StagesDialog({ open, onOpenChange, stages }: { open: boolean; onOpenChange: (open: boolean) => void; stages: LeadStage[] }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['stages'] });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const create = useMutation({ mutationFn: () => api.post('/app/crm/stages', { name }), onSuccess: () => { setName(''); refresh(); }, onError });
  const update = useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string }) => api.patch(`/app/crm/stages/${id}`, body), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/app/crm/stages/${id}`), onSuccess: refresh, onError });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put('/app/crm/stages/order', { ids }), onSuccess: refresh, onError });

  function moveStage(index: number, delta: number) {
    const ids = stages.map((stage) => stage.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    reorder.mutate(ids);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Etapas do funil" description="Personalize as etapas do CRM da sua empresa." size="md">
      <ul className="space-y-2">
        {stages.map((stage, index) => (
          <li key={stage.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
            <input type="color" value={stage.color} onChange={(event) => update.mutate({ id: stage.id, color: event.target.value })} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent" aria-label={`Cor da etapa ${stage.name}`} />
            <Input defaultValue={stage.name} onBlur={(event) => event.target.value !== stage.name && update.mutate({ id: stage.id, name: event.target.value })} aria-label="Nome da etapa" />
            <span className="w-16 text-center text-xs text-muted">{stage._count?.leads ?? 0} leads</span>
            <Button variant="ghost" size="icon-sm" onClick={() => moveStage(index, -1)} aria-label="Mover para cima"><ArrowUp className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => moveStage(index, 1)} aria-label="Mover para baixo"><ArrowDown className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(stage.id)} aria-label="Excluir etapa"><Trash2 className="h-4 w-4 text-red-500" /></Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nova etapa" aria-label="Nome da nova etapa" />
        <Button onClick={() => create.mutate()} disabled={name.trim().length < 2} loading={create.isPending}><Plus className="h-4 w-4" /> Adicionar</Button>
      </div>
    </Dialog>
  );
}
