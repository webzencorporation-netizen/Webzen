'use client';

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KanbanSquare, Search, Settings2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { ColorTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoneyCents, formatPhone, formatRelative } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { Lead, LeadStage, Member, Tag } from '../types';
import { StagesDialog } from './stages-dialog';

function LeadCard({ lead, draggable }: { lead: Lead; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const qualification = Object.entries(lead.qualification ?? {}).filter(([, value]) => value !== null && value !== '');
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn('rounded-lg border border-border bg-surface p-3 shadow-sm', draggable && 'cursor-grab active:cursor-grabbing', isDragging && 'z-50 rotate-1 shadow-xl ring-2 ring-brand-300')}
    >
      <Link href={`/app/contacts/${lead.contact.id}`} className="block text-sm font-medium text-slate-900 hover:underline" onPointerDown={(event) => event.stopPropagation()}>
        {lead.contact.name ?? formatPhone(lead.contact.phone)}
      </Link>
      {lead.title ? <p className="mt-0.5 text-xs text-slate-600">{lead.title}</p> : null}
      {qualification.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-muted">{qualification.map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`).join(' · ')}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">{lead.contact.tags.map(({ tag }) => <ColorTag key={tag.id} name={tag.name} color={tag.color} />)}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1">{lead.assignee ? <><UserRound className="h-3 w-3" />{lead.assignee.name.split(' ')[0]}</> : 'Sem responsável'}</span>
        <span>{lead.valueCents ? formatMoneyCents(lead.valueCents) : formatRelative(lead.createdAt)}</span>
      </div>
    </div>
  );
}

function StageColumn({ stage, leads, draggable }: { stage: LeadStage; leads: Lead[]; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = leads.reduce((sum, lead) => sum + (lead.valueCents ?? 0), 0);
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80">
      <div className="flex items-center justify-between px-3 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          {stage.name}
          <span className="rounded-full bg-surface px-1.5 text-xs text-muted">{leads.length}</span>
        </p>
        {total > 0 ? <span className="text-[11px] text-muted">{formatMoneyCents(total)}</span> : null}
      </div>
      <div ref={setNodeRef} className={cn('min-h-32 flex-1 space-y-2 overflow-y-auto rounded-b-xl p-2 scrollbar-thin', isOver && 'bg-brand-50 ring-2 ring-inset ring-brand-200')}>
        {leads.map((lead) => <LeadCard key={lead.id} lead={lead} draggable={draggable} />)}
      </div>
    </div>
  );
}

export function CrmBoard() {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [tagId, setTagId] = useState('');
  const [stagesOpen, setStagesOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const stages = useQuery({ queryKey: ['stages'], queryFn: () => api.get<LeadStage[]>('/app/crm/stages') });
  const leads = useQuery({ queryKey: ['leads', search, assigneeId, tagId], queryFn: () => api.get<Lead[]>('/app/crm/leads', { search, assigneeId, tagId }) });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.get<Member[]>('/app/team'), enabled: can('team:read') });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/app/crm/tags') });

  const move = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: string; stageId: string }) => api.post(`/app/crm/leads/${leadId}/move`, { stageId }),
    onMutate: async ({ leadId, stageId }) => {
      const key = ['leads', search, assigneeId, tagId];
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Lead[]>(key);
      const stage = stages.data?.find((item) => item.id === stageId);
      if (previous && stage) {
        client.setQueryData<Lead[]>(key, previous.map((lead) => (lead.id === leadId ? { ...lead, stage: { id: stage.id, key: stage.key, name: stage.name, color: stage.color } } : lead)));
      }
      return { previous, key };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(context.key, context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['leads'] }),
  });

  function onDragEnd(event: DragEndEvent) {
    const leadId = String(event.active.id);
    const stageId = event.over ? String(event.over.id) : null;
    const lead = leads.data?.find((item) => item.id === leadId);
    if (lead && stageId && lead.stage.id !== stageId) move.mutate({ leadId, stageId });
  }

  return (
    <PageContainer className="max-w-none">
      <PageHeader
        title="CRM"
        description="Arraste os cards para mover os leads entre as etapas do funil."
        actions={
          <>
            {can('contacts:export') ? <Button variant="secondary" asChild><a href="/api/app/exports/crm.csv"><Download className="h-4 w-4" /> Exportar</a></Button> : null}
            {can('crm:configure') ? <Button variant="secondary" onClick={() => setStagesOpen(true)}><Settings2 className="h-4 w-4" /> Etapas</Button> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead" className="pl-9" aria-label="Buscar lead" />
        </div>
        <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="sm:w-52" aria-label="Filtrar por responsável">
          <option value="">Todos os responsáveis</option>
          {(team.data ?? []).map((member) => <option key={member.user.id} value={member.user.id}>{member.user.name}</option>)}
        </Select>
        <Select value={tagId} onChange={(event) => setTagId(event.target.value)} className="sm:w-52" aria-label="Filtrar por etiqueta">
          <option value="">Todas as etiquetas</option>
          {(tags.data ?? []).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </Select>
      </div>
      {stages.isLoading || leads.isLoading ? (
        <div className="flex gap-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-96 w-72" />)}</div>
      ) : !stages.data || stages.data.length === 0 ? (
        <EmptyState icon={KanbanSquare} title="Nenhuma etapa configurada" />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex h-[calc(100vh-15rem)] min-h-[420px] gap-4 overflow-x-auto pb-4 scrollbar-thin">
            {stages.data.map((stage) => (
              <StageColumn key={stage.id} stage={stage} leads={(leads.data ?? []).filter((lead) => lead.stage.id === stage.id)} draggable={can('crm:write')} />
            ))}
          </div>
        </DndContext>
      )}
      <StagesDialog open={stagesOpen} onOpenChange={setStagesOpen} stages={stages.data ?? []} />
    </PageContainer>
  );
}
