'use client';

import { useQuery } from '@tanstack/react-query';
import { MessagesSquare, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ContactDetails } from '../contacts/contact-details';
import type { ConversationDetail } from '../types';
import { ChatPanel } from './chat-panel';
import { ConversationList } from './conversation-list';

/**
 * Caixa de entrada: lista | chat | contato (desktop). No celular, lista e chat são telas
 * separadas e os detalhes abrem em painel sobreposto.
 */
export function Inbox({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<ConversationDetail>(`/app/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
  });

  return (
    <div className="flex h-full min-h-0">
      <div className={cn('w-full shrink-0 border-r border-border bg-surface lg:w-[340px]', conversationId && 'hidden lg:block')}>
        <ConversationList selectedId={conversationId} filter={filter} onFilterChange={(value) => router.push(conversationId ? `/app/conversations/${conversationId}?filter=${value}` : `/app/conversations?filter=${value}`)} />
      </div>
      <div className={cn('min-w-0 flex-1', !conversationId && 'hidden lg:block')}>
        {conversationId ? (
          <ChatPanel conversationId={conversationId} filter={filter} onToggleDetails={() => setDetailsOpen((value) => !value)} />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-muted">
            <EmptyState icon={MessagesSquare} title="Selecione uma conversa" description="As mensagens do WhatsApp aparecem aqui em tempo real." />
          </div>
        )}
      </div>
      {conversationId && conversation.data ? (
        <>
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-border bg-surface scrollbar-thin xl:block">
            <ContactDetails contactId={conversation.data.contact.id} lead={conversation.data.lead} />
          </aside>
          {detailsOpen ? (
            <div className="fixed inset-0 z-40 xl:hidden">
              <div className="absolute inset-0 bg-ink-deep/40" onClick={() => setDetailsOpen(false)} />
              <aside className="absolute inset-y-0 right-0 w-[min(92vw,360px)] overflow-y-auto bg-surface shadow-xl">
                <div className="flex justify-end p-2">
                  <button onClick={() => setDetailsOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Fechar detalhes"><X className="h-5 w-5" /></button>
                </div>
                <ContactDetails contactId={conversation.data.contact.id} lead={conversation.data.lead} />
              </aside>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
