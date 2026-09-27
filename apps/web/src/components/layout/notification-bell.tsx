'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';

interface NotificationList {
  unread: number;
  items: { id: string; title: string; body: string | null; link: string | null; severity: string; createdAt: string; readAt: string | null }[];
}

export function NotificationBell() {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationList>('/app/notifications', { limit: 15 }),
    refetchInterval: 30_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/app/notifications/read-all'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/app/notifications/${id}/read`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Notificações">
        <Bell className="h-5 w-5" />
        {data && data.unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        ) : null}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-[min(92vw,360px)] rounded-xl border border-border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notificações</p>
            <button className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50" disabled={!data?.unread} onClick={() => markAll.mutate()}>
              Marcar todas como lidas
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {!data || data.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nenhuma notificação por aqui.</p>
            ) : (
              data.items.map((item) => (
                <DropdownMenu.Item key={item.id} asChild onSelect={() => !item.readAt && markOne.mutate(item.id)}>
                  <Link href={item.link ?? '#'} className={cn('block border-b border-border px-4 py-3 outline-none last:border-0 hover:bg-slate-50 focus:bg-slate-50', !item.readAt && 'bg-brand-50/40')}>
                    <div className="flex items-start gap-2">
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.severity === 'CRITICAL' ? 'bg-red-500' : item.severity === 'WARNING' ? 'bg-amber-500' : 'bg-sky-500', item.readAt && 'opacity-30')} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{item.title}</p>
                        {item.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.body}</p> : null}
                        <p className="mt-1 text-[11px] text-slate-400">{formatRelative(item.createdAt)}</p>
                      </div>
                    </div>
                  </Link>
                </DropdownMenu.Item>
              ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
