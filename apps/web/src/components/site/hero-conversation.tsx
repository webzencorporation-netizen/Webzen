'use client';

import { CalendarCheck, CheckCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

type Step =
  | { kind: 'message'; from: 'cliente' | 'webzen'; text: string; time: string }
  | { kind: 'event'; text: string; detail: string };

const SCRIPT: Step[] = [
  { kind: 'message', from: 'cliente', text: 'Boa noite! Ainda dá pra marcar uma limpeza de pele essa semana?', time: '23:47' },
  { kind: 'message', from: 'webzen', text: 'Boa noite! Dá sim. Quinta tenho 10h30 ou 15h. A limpeza leva 60 minutos e custa R$ 180.', time: '23:47' },
  { kind: 'message', from: 'cliente', text: 'Quinta 10h30 então 🙌', time: '23:48' },
  { kind: 'message', from: 'webzen', text: 'Fechado, Mariana: quinta, 10h30. Na quarta eu te mando um lembrete.', time: '23:48' },
  { kind: 'event', text: 'Agendamento criado', detail: 'Mariana · Limpeza de pele · qui 10:30' },
];

/** Atraso antes de cada passo (ms): o "digitando" aparece antes das respostas do WebZen. */
const DELAYS = [500, 1400, 1300, 1400, 900];

export function HeroConversation() {
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(SCRIPT.length);
      return;
    }
    const timers: number[] = [];
    let elapsed = 0;
    SCRIPT.forEach((step, index) => {
      elapsed += DELAYS[index] ?? 1000;
      if (step.kind === 'message' && step.from === 'webzen') {
        timers.push(window.setTimeout(() => setTyping(true), elapsed - 900));
      }
      timers.push(
        window.setTimeout(() => {
          setTyping(false);
          setVisible(index + 1);
        }, elapsed),
      );
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div className="relative w-full max-w-md rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 sm:p-5" aria-label="Exemplo de atendimento feito pelo WebZen às 23:47">
      <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">CB</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Clínica Bela Pele</p>
          <p className="text-xs text-white/55">Atendimento automático · WhatsApp</p>
        </div>
        <span className="rounded-full bg-hour/15 px-2 py-0.5 text-xs font-medium tabular-nums text-hour">23:47</span>
      </div>
      <ol className="min-h-[19rem] space-y-2.5" aria-live="polite">
        {SCRIPT.slice(0, visible).map((step, index) =>
          step.kind === 'message' ? (
            <li key={index} className={cn('flex animate-rise-in', step.from === 'webzen' && 'justify-end')}>
              <p
                className={cn(
                  'max-w-[86%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug',
                  step.from === 'webzen' ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white/10 text-white/90',
                )}
              >
                {step.text}
                <span className="ml-2 inline-flex items-center gap-0.5 align-bottom text-[11px] tabular-nums text-white/55">
                  {step.time}
                  {step.from === 'webzen' ? <CheckCheck className="h-3 w-3 text-brand-200" aria-label="lida" /> : null}
                </span>
              </p>
            </li>
          ) : (
            <li key={index} className="flex animate-rise-in justify-center pt-2">
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-ink shadow-[var(--shadow-overlay)]">
                <CalendarCheck className="h-4 w-4 text-brand-600" aria-hidden />
                {step.text}
                <span className="text-ink/65">· {step.detail}</span>
              </p>
            </li>
          ),
        )}
        {typing ? (
          <li className="flex justify-end" aria-label="WebZen está digitando">
            <span className="flex gap-1 rounded-2xl rounded-br-md bg-brand-600/70 px-3.5 py-3">
              {[0, 150, 300].map((delay) => (
                <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/90" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}
