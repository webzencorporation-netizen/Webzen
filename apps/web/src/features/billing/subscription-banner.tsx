'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';

const MESSAGES: Record<string, string> = {
  INCOMPLETE: 'Escolha um plano para ativar o atendimento automático.',
  TRIALING_ENDED: 'O teste grátis terminou. Assine um plano para continuar com o atendimento automático.',
  PAST_DUE: 'Não conseguimos cobrar a assinatura. Atualize a forma de pagamento para evitar a pausa da IA.',
  UNPAID: 'Pagamento pendente: o atendimento automático está pausado.',
  PAUSED: 'Assinatura pausada: o atendimento automático está pausado.',
  CANCELLED: 'Assinatura encerrada: o atendimento automático está pausado.',
};

/** Faixa no topo do painel quando a assinatura pede ação (só para quem vê a cobrança). */
export function SubscriptionBanner() {
  const can = useCan();
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<{ subscription: { status: string; trialEndsAt: string | null } | null }>('/app/billing'),
    enabled: can('billing:read'),
    staleTime: 60_000,
  });
  const subscription = billing.data?.subscription;
  if (!subscription) return null;
  const trialEnded = subscription.status === 'TRIALING' && subscription.trialEndsAt !== null && new Date(subscription.trialEndsAt).getTime() < Date.now();
  const message = trialEnded ? MESSAGES.TRIALING_ENDED : MESSAGES[subscription.status];
  if (!message) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      {message}
      {can('billing:manage') ? (
        <Link href="/app/settings/billing" className="font-semibold underline">
          {subscription.status === 'PAST_DUE' ? 'Atualizar pagamento' : 'Ver planos'}
        </Link>
      ) : null}
    </div>
  );
}
