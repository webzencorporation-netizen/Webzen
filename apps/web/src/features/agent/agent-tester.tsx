'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Clock, Coins, RotateCcw, Send, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PageContainer } from '@/components/layout/company-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { EmptyState, PageHeader, Switch } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumber, formatUsd } from '@/lib/format';

interface TestMessage {
  id: string;
  sender: string;
  text: string | null;
  createdAt: string;
  agentRunId: string | null;
}

interface Debug {
  outcome: string;
  model: string;
  durationMs: number;
  iterations: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  estimatedCostUsd: number;
  toolCalls: { name: string; input: unknown; ok: boolean; durationMs: number; result: unknown }[];
  knowledge: { id: string; title: string; score: number }[];
  handoff: { reason: string } | null;
}

export function AgentTester() {
  const client = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [showDebug, setShowDebug] = useState(true);
  const [debugByRun, setDebugByRun] = useState<Record<string, Debug>>({});
  const [lastDebug, setLastDebug] = useState<Debug | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversation = useQuery({ queryKey: ['agent-test'], queryFn: () => api.get<{ messages: TestMessage[] }>('/app/ai/test') });

  const send = useMutation({
    mutationFn: (message: string) => api.post<{ reply: string | null; debug: Debug }>('/app/ai/test', { message }),
    onMutate: () => setText(''),
    onSuccess: async (result) => {
      setLastDebug(result.debug);
      await client.invalidateQueries({ queryKey: ['agent-test'] });
      const messages = client.getQueryData<{ messages: TestMessage[] }>(['agent-test'])?.messages ?? [];
      const last = messages.at(-1);
      if (last?.agentRunId) setDebugByRun((current) => ({ ...current, [last.agentRunId as string]: result.debug }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const reset = useMutation({
    mutationFn: () => api.delete('/app/ai/test'),
    onSuccess: async () => {
      setDebugByRun({});
      setLastDebug(null);
      await client.invalidateQueries({ queryKey: ['agent-test'] });
    },
  });

  const messages = conversation.data?.messages ?? [];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, send.isPending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() && !send.isPending) send.mutate(text.trim());
  }

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Testar agente"
        description="Converse com o atendente como se fosse um cliente. Nada é enviado ao WhatsApp e ações (agendar, salvar dados) são apenas simuladas."
        actions={
          <>
            <Button variant="ghost" asChild><Link href="/app/agent"><ArrowLeft className="h-4 w-4" /> Configurações</Link></Button>
            <Button variant="secondary" onClick={() => reset.mutate()} loading={reset.isPending}><RotateCcw className="h-4 w-4" /> Nova conversa</Button>
          </>
        }
      />
      <div className={cn('grid gap-6', showDebug && 'lg:grid-cols-[1fr_360px]')}>
        <Card className="flex h-[calc(100vh-15rem)] min-h-[420px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-brand-600" /> Simulação</p>
            <label className="flex items-center gap-2 text-xs text-muted">
              Mostrar detalhes técnicos <Switch checked={showDebug} onCheckedChange={setShowDebug} label="Mostrar detalhes técnicos" />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f3f4f1] px-4 py-4 scrollbar-thin">
            {messages.length === 0 ? (
              <EmptyState icon={Bot} title="Comece a conversa" description='Experimente: "oi, quanto custa uma limpeza de pele?" ou "quero falar com um atendente".' />
            ) : (
              messages.map((message) => {
                const inbound = message.sender === 'CONTACT';
                const debug = message.agentRunId && !inbound ? debugByRun[message.agentRunId] : undefined;
                return (
                  <div key={message.id} className={cn('my-1.5 flex', inbound ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm', inbound ? 'rounded-br-md bg-slate-800 text-white' : 'rounded-bl-md bg-white text-slate-800')}>
                      <p className="whitespace-pre-wrap">{message.text}</p>
                      {showDebug && debug ? (
                        <p className="mt-1 text-[10px] text-slate-400">
                          {debug.durationMs} ms · {formatNumber(debug.usage.inputTokens + debug.usage.outputTokens)} tokens · {formatUsd(debug.estimatedCostUsd)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
            {send.isPending ? (
              <div className="my-1.5 flex justify-start">
                <div className="flex gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm" aria-label="Digitando">
                  {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${dot * 120}ms` }} />)}
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-border p-3">
            <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva como se fosse o cliente…" aria-label="Mensagem de teste" autoFocus />
            <Button type="submit" size="icon" disabled={!text.trim()} loading={send.isPending} aria-label="Enviar">{!send.isPending ? <Send className="h-4 w-4" /> : null}</Button>
          </form>
        </Card>

        {showDebug ? (
          <Card className="h-fit">
            <CardHeader title="Última execução" description="Ferramentas, conhecimento e consumo." />
            {lastDebug ? (
              <div className="space-y-4 p-4 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-surface-muted p-2"><Clock className="mb-1 h-3.5 w-3.5 text-slate-400" />{lastDebug.durationMs} ms · {lastDebug.iterations} etapa(s)</div>
                  <div className="rounded-lg bg-surface-muted p-2"><Coins className="mb-1 h-3.5 w-3.5 text-slate-400" />{formatUsd(lastDebug.estimatedCostUsd)}</div>
                  <div className="col-span-2 rounded-lg bg-surface-muted p-2">
                    Modelo <strong>{lastDebug.model}</strong> · entrada {formatNumber(lastDebug.usage.inputTokens)} · saída {formatNumber(lastDebug.usage.outputTokens)} · cache {formatNumber(lastDebug.usage.cacheReadTokens)}
                  </div>
                </div>
                {lastDebug.handoff ? <Badge tone="amber">Pediu atendimento humano: {lastDebug.handoff.reason}</Badge> : null}
                {lastDebug.outcome !== 'answered' && lastDebug.outcome !== 'handoff' ? <Badge tone="red">Resultado: {lastDebug.outcome}</Badge> : null}
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase text-muted"><Wrench className="h-3.5 w-3.5" /> Ferramentas</p>
                  {lastDebug.toolCalls.length === 0 ? <p className="text-xs text-muted">Nenhuma ferramenta usada.</p> : null}
                  <ul className="space-y-2">
                    {lastDebug.toolCalls.map((call, index) => (
                      <li key={index} className="rounded-lg border border-border p-2 text-xs">
                        <p className="flex items-center justify-between font-medium">
                          {call.name} <Badge tone={call.ok ? 'brand' : 'red'}>{call.ok ? 'ok' : 'erro'}</Badge>
                        </p>
                        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-1.5 font-mono text-[10px] text-slate-600 scrollbar-thin">{JSON.stringify({ entrada: call.input, resultado: call.result }, null, 1)}</pre>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase text-muted">Conhecimento recuperado</p>
                  {lastDebug.knowledge.length === 0 ? <p className="text-xs text-muted">Nenhum trecho relevante.</p> : (
                    <ul className="space-y-1 text-xs">{lastDebug.knowledge.map((hit) => <li key={hit.id} className="flex justify-between gap-2"><span className="truncate">{hit.title}</span><span className="text-muted">{hit.score}</span></li>)}</ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="p-4 text-sm text-muted">Envie uma mensagem para ver os detalhes.</p>
            )}
          </Card>
        ) : null}
      </div>
    </PageContainer>
  );
}
