'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell, FormAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { api, ApiError, errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/redirect';
import type { Me } from '@/lib/session';

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const next = safeNextPath(useSearchParams().get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setUnverified(false);
    try {
      const me = await api.post<Me>('/auth/login', { email, password });
      queryClient.setQueryData(['me'], me);
      router.replace(next ?? (!me.activeCompany && me.platformRole ? '/platform' : '/app'));
    } catch (loginError) {
      const reason = loginError instanceof ApiError ? (loginError.details as { reason?: string } | undefined)?.reason : undefined;
      setUnverified(reason === 'EMAIL_NOT_VERIFIED');
      setError(errorMessage(loginError));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    await api.post('/auth/resend-verification', { email }).catch(() => undefined);
    setResent(true);
  }

  return (
    <AuthShell
      title="Entrar no WebZen"
      description="Acesse o painel da sua empresa."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link href="/cadastro" className="font-medium text-brand-700 hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="E-mail">
          {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" />}
        </Field>
        <Field label="Senha">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <div className="-mt-2 text-right">
          <Link href="/esqueci-senha" className="text-sm text-brand-700 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        {error ? (
          <FormAlert>
            {error}
            {unverified ? (
              resent ? (
                <span className="mt-1 block">Enviamos um novo link. Confira sua caixa de entrada e o spam.</span>
              ) : (
                <button type="button" className="mt-1 block font-medium underline" onClick={() => void resend()}>
                  Reenviar link de confirmação
                </button>
              )
            ) : null}
          </FormAlert>
        ) : null}
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Entrar
        </Button>
      </form>
    </AuthShell>
  );
}
