import type { Metadata } from 'next';
import { CHANGELOG } from '@/lib/changelog';

export const metadata: Metadata = {
  title: 'Novidades',
  description: 'O que mudou no WebZen: novos recursos e melhorias.',
  alternates: { canonical: '/novidades' },
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function ChangelogPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">Novidades do WebZen</h1>
      <p className="mt-3 text-muted">Recursos novos e melhorias, do mais recente para o mais antigo.</p>
      <ol className="mt-12 space-y-12 border-l border-border pl-6">
        {CHANGELOG.map((entry) => (
          <li key={entry.date} className="relative">
            <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-canvas bg-brand-500" aria-hidden />
            <time dateTime={entry.date} className="text-sm font-medium text-brand-700">
              {dateFormat.format(new Date(`${entry.date}T00:00:00Z`))}
            </time>
            <h2 className="mt-1 font-display text-xl font-bold text-foreground">{entry.title}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-700">
              {entry.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
