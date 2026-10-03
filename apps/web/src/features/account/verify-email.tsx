'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AuthShell, FormAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/session';

/** Confirma o e-mail pelo link, já abre a sessão e leva para a configuração inicial. */
export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(token ? null : 'Link incompleto.');
  const started = useRef(false);

  useEffect(() => {
    // O token é de uso único: o efeito duplo do StrictMode não pode gastá-lo duas vezes.
    if (!token || started.current) return;
    started.current = true;
    api
      .post<Me>('/auth/verify-email', { token })
      .then((me) => {
        client.setQueryData(['me'], me);
        router.replace(me.activeCompany && !me.activeCompany.onboardingDone ? '/app/onboarding' : '/app');
      })
      .catch((requestError: unknown) => setError(errorMessage(requestError)));
  }, [token, router, client]);

  if (!error) {
    return (
      <AuthShell title="Confirmando seu e-mail" description="Só um instante.">
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Não foi possível confirmar" description="O link pode ter expirado ou já ter sido usado.">
      <div className="space-y-5">
        <FormAlert>{error}</FormAlert>
        <p className="text-sm text-muted">Se você já confirmou, é só entrar. Para receber um link novo, tente entrar com seu e-mail e senha.</p>
        <Button asChild className="w-full" size="lg">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
