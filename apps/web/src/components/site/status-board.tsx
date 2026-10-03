'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type State = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'not_monitored';

const STATES: Record<State, { label: string; dot: string; banner: string }> = {
  operational: { label: 'Operacional', dot: 'bg-brand-500', banner: 'Todos os sistemas operando normalmente.' },
  degraded: { label: 'Desempenho reduzido', dot: 'bg-hour', banner: 'Alguns sistemas estão mais lentos que o normal.' },
  partial_outage: { label: 'Interrupção parcial', dot: 'bg-orange-500', banner: 'Parte do serviço está indisponível.' },
  major_outage: { label: 'Fora do ar', dot: 'bg-red-500', banner: 'Há uma interrupção em andamento. Estamos trabalhando nisso.' },
  not_monitored: { label: 'Sem monitoramento', dot: 'bg-slate-300', banner: '' },
};

interface PublicStatus {
  overall: State;
  components: { key: string; name: string; state: State }[];
  checkedAt: string;
}

export function StatusBoard() {
  const status = useQuery({
    queryKey: ['public-status'],
    queryFn: () => api.get<PublicStatus>('/public/status'),
    refetchInterval: 60_000,
    retry: 1,
  });

  if (status.isLoading) return <Skeleton className="mt-10 h-72 rounded-2xl" />;
  if (status.isError || !status.data) {
    return (
      <div role="alert" className="mt-10 rounded-2xl bg-red-50 p-5 text-red-700 ring-1 ring-inset ring-red-200">
        Não foi possível consultar o status agora. Se o painel também não abre, pode haver uma interrupção em andamento.
      </div>
    );
  }

  const overall = STATES[status.data.overall];
  return (
    <>
      <div className={cn('mt-10 flex items-center gap-3 rounded-2xl p-5 text-white', status.data.overall === 'operational' ? 'bg-brand-600' : 'bg-ink')}>
        <span className={cn('h-3 w-3 rounded-full', overall.dot)} aria-hidden />
        <p className="font-medium">{overall.banner}</p>
      </div>
      <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
        {status.data.components.map((component) => {
          const state = STATES[component.state];
          return (
            <li key={component.key} className="flex items-center justify-between gap-4 px-5 py-4">
              <span className="font-medium text-foreground">{component.name}</span>
              <span className="flex items-center gap-2 text-sm text-slate-600">
                <span className={cn('h-2.5 w-2.5 rounded-full', state.dot)} aria-hidden />
                {state.label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Última verificação: {new Date(status.data.checkedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
      </p>
    </>
  );
}
