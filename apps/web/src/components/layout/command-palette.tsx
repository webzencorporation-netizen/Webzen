'use client';

import { useQuery } from '@tanstack/react-query';
import { Contact, CornerDownLeft, KanbanSquare, LifeBuoy, MessagesSquare, Package, Search, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dialog as RadixDialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatPhone } from '@/lib/format';
import { useCan } from '@/lib/session';
import { COMPANY_NAV } from './nav';

interface SearchResult {
  contacts: { id: string; name: string | null; phone: string }[];
  conversations: { id: string; lastMessagePreview: string | null; contact: { name: string | null; phone: string } }[];
  leads: { id: string; title: string; contact: { name: string | null }; stage: { name: string } }[];
  services: { id: string; name: string }[];
}

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  href: string;
}

const EXTRA_ACTIONS: (Omit<Item, 'group'> & { permission: Parameters<ReturnType<typeof useCan>>[0] })[] = [
  { id: 'new-ticket', label: 'Abrir chamado de suporte', icon: LifeBuoy, href: '/app/support', permission: 'support:write' },
  { id: 'billing', label: 'Assinatura e faturas', icon: Package, href: '/app/settings/billing', permission: 'billing:read' },
  { id: 'agent-test', label: 'Testar o atendente', icon: MessagesSquare, href: '/app/agent/test', permission: 'ai:test' },
];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Paleta de comandos (Ctrl/⌘ + K): navegação rápida e busca em contatos, conversas, leads e serviços. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const can = useCan();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const term = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ['global-search', term],
    queryFn: () => api.get<SearchResult>('/app/search', { q: term }),
    enabled: open && term.length >= 2 && can('contacts:read'),
    staleTime: 10_000,
  });

  const items = useMemo<Item[]>(() => {
    const needle = query.trim().toLowerCase();
    const navigation: Item[] = [
      ...COMPANY_NAV.filter((item) => can(item.permission)).map((item) => ({ id: `nav-${item.href}`, group: 'Ir para', label: item.label, icon: item.icon, href: item.href })),
      ...EXTRA_ACTIONS.filter((action) => can(action.permission)).map(({ permission: _permission, ...action }) => ({ ...action, group: 'Ações' })),
    ].filter((item) => !needle || item.label.toLowerCase().includes(needle));
    const data = term.length >= 2 ? search.data : undefined;
    const results: Item[] = data
      ? [
          ...data.contacts.map((contact) => ({ id: `c-${contact.id}`, group: 'Contatos', label: contact.name ?? formatPhone(contact.phone), hint: formatPhone(contact.phone), icon: Contact, href: `/app/contacts/${contact.id}` })),
          ...data.conversations.map((conversation) => ({
            id: `v-${conversation.id}`,
            group: 'Conversas',
            label: conversation.contact.name ?? formatPhone(conversation.contact.phone),
            hint: conversation.lastMessagePreview ?? undefined,
            icon: MessagesSquare,
            href: `/app/conversations/${conversation.id}`,
          })),
          ...data.leads.map((lead) => ({ id: `l-${lead.id}`, group: 'Leads', label: lead.title || lead.contact.name || 'Lead sem nome', hint: lead.stage.name, icon: KanbanSquare, href: '/app/crm' })),
          ...data.services.map((service) => ({ id: `s-${service.id}`, group: 'Serviços', label: service.name, icon: Package, href: '/app/catalog' })),
        ]
      : [];
    return [...results, ...navigation];
  }, [query, term, search.data, can]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function go(item: Item | undefined) {
    if (!item) return;
    onOpenChange(false);
    router.push(item.href);
  }

  let lastGroup = '';
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-ink-deep/50 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-rise-in overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-overlay)]"
          aria-describedby={undefined}
        >
          <RadixDialog.Title className="sr-only">Buscar e navegar</RadixDialog.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, items.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  go(items[active]);
                }
              }}
              placeholder="Buscar contato, conversa, lead ou página…"
              className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-slate-400"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-list"
              aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
          </div>
          <ul id="command-list" ref={listRef} role="listbox" className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
            {items.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted">{search.isFetching ? 'Buscando…' : 'Nada encontrado.'}</li>
            ) : (
              items.map((item, index) => {
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <li key={item.id} role="presentation">
                    {header ? <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted">{header}</p> : null}
                    <div
                      id={`cmd-${item.id}`}
                      role="option"
                      aria-selected={index === active}
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(item)}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm', index === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700')}
                    >
                      <item.icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {item.hint ? <span className="ml-auto truncate pl-3 text-xs text-muted">{item.hint}</span> : null}
                      {index === active ? <CornerDownLeft className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden /> : null}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Atalho global Ctrl/⌘ + K. */
export function useCommandPaletteShortcut(setOpen: (open: boolean | ((current: boolean) => boolean)) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}
