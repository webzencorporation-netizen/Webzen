'use client';

import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Erro inesperado de renderização: mensagem simples, sem detalhes técnicos, com nova tentativa. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-2xl font-bold text-foreground">Não foi possível carregar esta página</h1>
      <p className="mt-2 max-w-sm text-muted">Tente de novo. Se continuar, confira a página de status ou fale com o suporte.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={() => reset()}>
          <RotateCcw className="h-4 w-4" /> Tentar novamente
        </Button>
        <Button asChild variant="secondary">
          <Link href="/status">Ver status</Link>
        </Button>
      </div>
    </main>
  );
}
