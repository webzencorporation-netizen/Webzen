'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PLAN_LIMIT_EVENT } from '@/lib/api';
import { useCan } from '@/lib/session';

/**
 * Aviso de upgrade: aparece quando o backend recusa uma ação por limite do plano ou por
 * recurso fora do plano. Quem gerencia a assinatura vai direto para a troca de plano;
 * os demais são orientados a falar com o responsável.
 */
export function PlanLimitDialog() {
  const can = useCan();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onLimit = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') setMessage(event.detail);
    };
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, []);

  const close = () => setMessage(null);
  const manage = can('billing:manage');

  return (
    <Dialog
      open={message !== null}
      onOpenChange={(open) => !open && close()}
      title="Seu plano chegou ao limite"
      size="sm"
      footer={
        manage ? (
          <>
            <Button variant="ghost" onClick={close}>
              Agora não
            </Button>
            <Button asChild onClick={close}>
              <Link href="/app/settings/billing">Ver planos</Link>
            </Button>
          </>
        ) : (
          <Button onClick={close}>Entendi</Button>
        )
      }
    >
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="space-y-2 text-sm">
          <p className="text-foreground">{message}</p>
          <p className="text-muted">
            {manage
              ? 'Mude para um plano maior para continuar. A diferença é cobrada proporcionalmente e nada do que você já cadastrou se perde.'
              : 'Peça ao proprietário da conta para mudar o plano em Configurações → Assinatura.'}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
