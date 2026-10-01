'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell, FormAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

const PASSWORD_MIN = 10;

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN) return setError(`Use pelo menos ${PASSWORD_MIN} caracteres.`);
    if (password !== confirm) return setError('As senhas não conferem.');
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Link incompleto" description="Abra o link exatamente como chegou no e-mail ou peça um novo.">
        <Button asChild className="w-full">
          <Link href="/esqueci-senha">Pedir novo link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar nova senha" description="Depois de salvar, as outras sessões abertas serão encerradas.">
      {done ? (
        <div className="space-y-5">
          <FormAlert tone="success">Senha alterada. Entre com a nova senha.</FormAlert>
          <Button asChild className="w-full" size="lg">
            <Link href="/login">Ir para o login</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field label="Nova senha" hint={`Pelo menos ${PASSWORD_MIN} caracteres.`}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          <Field label="Repita a nova senha">
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
          </Field>
          {error ? (
            <FormAlert>
              {error}{' '}
              {error.includes('expirado') ? (
                <Link href="/esqueci-senha" className="font-medium underline">
                  Pedir novo link
                </Link>
              ) : null}
            </FormAlert>
          ) : null}
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Salvar nova senha
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
