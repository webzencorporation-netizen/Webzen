'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Onboarding {
  steps: { key: string; title: string; done: boolean; skipped: boolean }[];
  progress: number;
  finished: boolean;
}

/** Primeiros passos no painel inicial. Some quando a configuração é concluída. */
export function SetupChecklist() {
  const onboarding = useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<Onboarding>('/app/company/onboarding') });
  const data = onboarding.data;
  if (!data || data.finished) return null;
  const next = data.steps.find((step) => !step.done && !step.skipped);
  return (
    <Card className="mb-6">
      <CardHeader
        title={`Configuração da conta: ${data.progress}%`}
        description="Complete os passos para o atendente responder seus clientes."
        action={
          <Link href="/app/onboarding" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            {next ? `Continuar: ${next.title}` : 'Ativar atendimento'} <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <CardContent>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Progresso da configuração" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.progress}>
          <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${data.progress}%` }} />
        </div>
        <ol className="mt-5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  step.done ? 'bg-brand-600 text-white' : 'border border-slate-300 text-transparent',
                )}
                aria-hidden
              >
                <Check className="h-3 w-3" />
              </span>
              <span className={cn(step.done ? 'text-muted line-through' : step.skipped ? 'text-muted' : 'text-foreground')}>
                {step.title}
                {step.skipped && !step.done ? ' (pulado)' : ''}
              </span>
              <span className="sr-only">{step.done ? 'concluído' : 'pendente'}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
