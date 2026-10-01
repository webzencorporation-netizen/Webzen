'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthShell, FormAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Informe um e-mail válido.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Esqueci minha senha"
      description="Informe o e-mail da conta. Enviaremos um link para criar uma senha nova."
      footer={
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {sent ? (
        <FormAlert tone="success">
          Se houver uma conta com <strong>{email.trim()}</strong>, o link chega em instantes. Ele vale por 60 minutos e só pode ser usado uma vez.
        </FormAlert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field label="E-mail">
            {(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" />}
          </Field>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
