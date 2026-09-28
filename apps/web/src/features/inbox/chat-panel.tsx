'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, CheckCircle2, Info, MoreVertical, PauseCircle, PlayCircle, Send, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Skeleton, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { ChatMessage, ConversationDetail, Member } from '../types';
import { ModeBadge } from './conversation-list';
import { MessageBubble } from './message-bubble';
import { TemplateDialog } from './template-dialog';

type ModeAction = 'take_over' | 'return_to_ai' | 'pause' | 'resume' | 'request_human';

export function ChatPanel({ conversationId, filter, onToggleDetails }: { conversationId: string; filter: string; onToggleDetails: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [text, setText] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<ConversationDetail>(`/app/conversations/${conversationId}`),
    refetchInterval: 10_000,
  });
  const messages = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api.get<{ items: ChatMessage[]; hasMore: boolean }>(`/app/conversations/${conversationId}/messages`, { limit: 100 }),
    refetchInterval: 5_000,
  });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.get<Member[]>('/app/team'), enabled: can('conversations:assign') });

  const lastCount = messages.data?.items.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lastCount, conversationId]);

  useEffect(() => {
    if (conversation.data && conversation.data.unreadCount > 0) {
      void api.post(`/app/conversations/${conversationId}/read`).then(() => {
        void client.invalidateQueries({ queryKey: ['conversations'] });
        void client.invalidateQueries({ queryKey: ['conversation-counters'] });
      });
    }
  }, [conversation.data, conversationId, client]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['conversation', conversationId] });
    void client.invalidateQueries({ queryKey: ['messages', conversationId] });
    void client.invalidateQueries({ queryKey: ['conversations'] });
  };

  const send = useMutation({
    mutationFn: (body: string) => api.post(`/app/conversations/${conversationId}/messages`, { text: body }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const mode = useMutation({
    mutationFn: (action: ModeAction) => api.post(`/app/conversations/${conversationId}/mode`, { action }),
    onSuccess: (_, action) => {
      refresh();
      toast.success(
        { take_over: 'Você assumiu a conversa.', return_to_ai: 'Conversa devolvida para a IA.', pause: 'IA pausada nesta conversa.', resume: 'IA retomada.', request_human: 'Conversa enviada para a fila.' }[action],
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const status = useMutation({
    mutationFn: (value: 'OPEN' | 'CLOSED') => api.post(`/app/conversations/${conversationId}/status`, { status: value }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const assign = useMutation({
    mutationFn: (userId: string | null) => api.post(`/app/conversations/${conversationId}/assign`, { userId }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (text.trim()) send.mutate(text.trim());
    }
  }

  const data = conversation.data;
  if (conversation.isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const windowClosed = data.window.requiresTemplate;
  const canReply = can('conversations:reply');
  const menuItem = 'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none hover:bg-slate-100 focus:bg-slate-100';

  return (
    <div className="flex h-full flex-col bg-[#f3f4f1]">
      <div className="flex items-center gap-3 border-b border-border bg-white px-3 py-2.5 sm:px-4">
        <Link href={`/app/conversations?filter=${filter}`} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Voltar para a lista">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{data.contact.name ?? formatPhone(data.contact.phone)}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{formatPhone(data.contact.phone)}</span>
            <ModeBadge mode={data.mode} />
            {data.status === 'WAITING_HUMAN' ? <Badge tone="amber">Aguardando equipe</Badge> : null}
            {data.status === 'CLOSED' ? <Badge>Encerrada</Badge> : null}
          </div>
        </div>
        {can('conversations:mode') ? (
          data.mode === 'AI' ? (
            <Button size="sm" variant="secondary" onClick={() => mode.mutate('take_over')} loading={mode.isPending}>
              <UserCheck className="h-4 w-4" /> <span className="hidden sm:inline">Assumir conversa</span>
            </Button>
          ) : (
            <Button size="sm" onClick={() => mode.mutate('return_to_ai')} loading={mode.isPending}>
              <Bot className="h-4 w-4" /> <span className="hidden sm:inline">Devolver para IA</span>
            </Button>
          )
        ) : null}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Mais ações">
            <MoreVertical className="h-5 w-5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 rounded-xl border border-border bg-white p-1.5 shadow-xl">
              {can('conversations:mode') && data.mode === 'AI' ? (
                <DropdownMenu.Item className={menuItem} onSelect={() => mode.mutate('pause')}>
                  <PauseCircle className="h-4 w-4 text-slate-400" /> Pausar IA nesta conversa
                </DropdownMenu.Item>
              ) : null}
              {can('conversations:mode') && data.mode === 'PAUSED' ? (
                <DropdownMenu.Item className={menuItem} onSelect={() => mode.mutate('resume')}>
                  <PlayCircle className="h-4 w-4 text-slate-400" /> Retomar IA
                </DropdownMenu.Item>
              ) : null}
              {can('conversations:mode') && data.mode === 'AI' ? (
                <DropdownMenu.Item className={menuItem} onSelect={() => mode.mutate('request_human')}>
                  <UserCheck className="h-4 w-4 text-slate-400" /> Enviar para fila humana
                </DropdownMenu.Item>
              ) : null}
              {canReply ? (
                <DropdownMenu.Item className={menuItem} onSelect={() => status.mutate(data.status === 'CLOSED' ? 'OPEN' : 'CLOSED')}>
                  <CheckCircle2 className="h-4 w-4 text-slate-400" /> {data.status === 'CLOSED' ? 'Reabrir conversa' : 'Encerrar conversa'}
                </DropdownMenu.Item>
              ) : null}
              {can('conversations:assign') && team.data ? (
                <>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Label className="px-2.5 py-1 text-[11px] font-semibold uppercase text-muted">Responsável</DropdownMenu.Label>
                  <DropdownMenu.Item className={menuItem} onSelect={() => assign.mutate(null)}>
                    Sem responsável
                  </DropdownMenu.Item>
                  {team.data
                    .filter((member) => member.isActive)
                    .map((member) => (
                      <DropdownMenu.Item key={member.id} className={menuItem} onSelect={() => assign.mutate(member.user.id)}>
                        {member.user.name} {data.assignee?.id === member.user.id ? '✓' : ''}
                      </DropdownMenu.Item>
                    ))}
                </>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button className="hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:block xl:hidden" onClick={onToggleDetails} aria-label="Detalhes do contato">
          <Info className="h-5 w-5" />
        </button>
        <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onToggleDetails} aria-label="Detalhes do contato">
          <Info className="h-5 w-5" />
        </button>
      </div>

      {data.openHandoff ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <strong>Encaminhada para a equipe:</strong> {data.openHandoff.reason}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 scrollbar-thin sm:px-6">
        {messages.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
          </div>
        ) : (
          messages.data?.items.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        <div ref={bottomRef} />
      </div>

      {canReply ? (
        <div className="border-t border-border bg-white p-3">
          {windowClosed ? (
            <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span>A janela de 24h desta conversa está fechada. Para falar com o cliente, envie um template aprovado.</span>
              <Button size="sm" variant="secondary" onClick={() => setTemplateOpen(true)}>
                Enviar template
              </Button>
            </div>
          ) : (
            <>
              {data.mode === 'AI' ? <p className="mb-2 text-[11px] text-muted">A IA está atendendo. Se você responder, assumirá a conversa automaticamente.</p> : null}
              <div className="flex items-end gap-2">
                <Textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Digite uma mensagem"
                  title="Enter envia · Shift+Enter quebra linha"
                  className="max-h-40 min-h-[44px] resize-none"
                  rows={1}
                  aria-label="Mensagem"
                />
                <Button size="icon" onClick={() => text.trim() && send.mutate(text.trim())} loading={send.isPending} aria-label="Enviar mensagem">
                  {!send.isPending ? <Send className="h-4 w-4" /> : null}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} conversationId={conversationId} onSent={refresh} />
    </div>
  );
}
