'use client';

import { useQuery } from '@tanstack/react-query';
import { Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, ColorTag } from '@/components/ui/badge';
import { Input } from '@/components/ui/form';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/misc';
import { api, type Paginated } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPhone, formatRelative } from '@/lib/format';
import type { ConversationListItem } from '../types';

export const INBOX_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas', counter: 'unread' },
  { value: 'waiting', label: 'Aguardando', counter: 'waiting' },
  { value: 'ai', label: 'IA' },
  { value: 'human', label: 'Humano' },
  { value: 'unassigned', label: 'Sem responsável', counter: 'unassigned' },
  { value: 'mine', label: 'Minhas' },
  { value: 'closed', label: 'Encerradas' },
] as const;

type Counts = Record<'unread' | 'waiting' | 'unassigned' | 'attention', number>;

export function ModeBadge({ mode }: { mode: ConversationListItem['mode'] }) {
  if (mode === 'AI') return <Badge tone="brand">IA</Badge>;
  if (mode === 'HUMAN') return <Badge tone="blue">Humano</Badge>;
  return <Badge tone="amber">IA pausada</Badge>;
}

export function ConversationList({ selectedId, filter, onFilterChange }: { selectedId?: string; filter: string; onFilterChange: (filter: string) => void }) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['conversations', filter, search],
    queryFn: () => api.get<Paginated<ConversationListItem> & { counts: Counts }>('/app/conversations', { filter, search, pageSize: 50 }),
    refetchInterval: 10_000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" className="pl-9" aria-label="Buscar conversas" />
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
          {INBOX_FILTERS.map((item) => {
            const count = 'counter' in item ? data?.counts[item.counter] : undefined;
            return (
              <button
                key={item.value}
                onClick={() => onFilterChange(item.value)}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition',
                  filter === item.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {item.label}
                {count ? <span className={cn('rounded-full px-1.5 text-[10px]', filter === item.value ? 'bg-white/20' : 'bg-white text-slate-700')}>{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="Nenhuma conversa aqui" description="Ajuste os filtros ou aguarde novas mensagens." />
        ) : (
          <ul>
            {data.items.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/app/conversations/${conversation.id}?filter=${filter}`}
                  className={cn(
                    'flex gap-3 border-b border-border px-3 py-3 transition hover:bg-slate-50',
                    selectedId === conversation.id && 'bg-brand-50/60 hover:bg-brand-50',
                    conversation.needsAttention && 'border-l-2 border-l-amber-500',
                  )}
                >
                  <Avatar name={conversation.contact.name ?? conversation.contact.phone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn('truncate text-sm', conversation.unreadCount > 0 ? 'font-semibold text-slate-900' : 'font-medium text-slate-800')}>
                        {conversation.contact.name ?? formatPhone(conversation.contact.phone)}
                      </p>
                      <span className="shrink-0 text-[11px] text-muted">{formatRelative(conversation.lastMessageAt)}</span>
                    </div>
                    {conversation.contact.name ? <p className="text-[11px] text-slate-400">{formatPhone(conversation.contact.phone)}</p> : null}
                    <div className="mt-1 flex items-center gap-2">
                      <p className="line-clamp-1 flex-1 text-xs text-muted">{conversation.lastMessagePreview ?? '—'}</p>
                      {conversation.unreadCount > 0 ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{conversation.unreadCount}</span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <ModeBadge mode={conversation.mode} />
                      {conversation.status === 'WAITING_HUMAN' ? <Badge tone="amber">Aguardando</Badge> : null}
                      {conversation.assignee ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted">
                          <UserRound className="h-3 w-3" />
                          {conversation.assignee.name.split(' ')[0]}
                        </span>
                      ) : null}
                      {conversation.contact.tags.slice(0, 2).map((tag) => (
                        <ColorTag key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
