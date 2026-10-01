import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

/** Trecho de conversa do painel noturno: o atendimento acontecendo fora do expediente. */
const NIGHT_THREAD = [
  { from: 'cliente', text: 'Oi! Vocês têm horário amanhã de manhã?', time: '23:47' },
  { from: 'webzen', text: 'Temos sim: 9h, 10h30 ou 11h. Qual fica melhor?', time: '23:47' },
  { from: 'cliente', text: '10h30, por favor.', time: '23:48' },
  { from: 'webzen', text: 'Fechado: amanhã às 10h30. Te mando um lembrete de manhã.', time: '23:48' },
] as const;

export function AuthShell({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink-deep p-12 text-white lg:flex">
        <Link href="/" className="w-fit text-white" aria-label="WebZen — página inicial">
          <Logo markClassName="text-brand-400" />
        </Link>
        <div className="max-w-md">
          <p className="font-display text-3xl font-bold leading-tight tracking-tight">Sua loja fechou. O atendimento, não.</p>
          <ol className="mt-8 space-y-2.5" aria-label="Exemplo de conversa atendida pelo WebZen">
            {NIGHT_THREAD.map((message, index) => (
              <li key={index} className={message.from === 'webzen' ? 'flex justify-end' : 'flex'}>
                <span className={message.from === 'webzen' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm' : 'max-w-[85%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm'}>
                  {message.text}
                  <time className="ml-2 align-bottom text-[11px] tabular-nums text-hour">{message.time}</time>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} WebZen</p>
      </section>
      <section className="flex flex-col px-6 py-10 sm:px-10">
        <Link href="/" className="mb-10 w-fit text-foreground lg:hidden" aria-label="WebZen — página inicial">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 text-sm text-muted">{footer}</div> : null}
        </div>
      </section>
    </main>
  );
}

/** Mensagem de erro/aviso de formulário (anunciada por leitores de tela). */
export function FormAlert({ tone = 'error', children }: { tone?: 'error' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'bg-red-50 text-red-700 ring-red-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
    success: 'bg-brand-50 text-brand-800 ring-brand-200',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${styles}`}>
      {children}
    </div>
  );
}
