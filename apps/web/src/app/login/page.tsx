'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Bot, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/login', { email, password });
      queryClient.setQueryData(['me'], me);
      router.replace(!me.activeCompany && me.platformRole ? '/platform' : '/app');
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"><Bot className="h-5 w-5" /></span>
          BotsSaaS
        </div>
        <div className="max-w-md space-y-6">
          <h1 className="text-3xl font-semibold leading-tight">Atendimento no WhatsApp com IA que conhece o seu negócio.</h1>
          <ul className="space-y-3 text-sm text-brand-50/90">
            <li className="flex gap-3"><MessageCircle className="h-5 w-5 shrink-0" /> Responde clientes 24h com as informações da sua empresa.</li>
            <li className="flex gap-3"><Sparkles className="h-5 w-5 shrink-0" /> Agenda, qualifica leads e passa para a equipe quando precisa.</li>
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0" /> API oficial do WhatsApp e dados isolados por empresa.</li>
          </ul>
        </div>
        <p className="text-xs text-brand-100/60">© {new Date().getFullYear()} BotsSaaS</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6" noValidate>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Entrar no painel</h2>
            <p className="mt-1 text-sm text-muted">Use o e-mail e a senha fornecidos pela nossa equipe.</p>
          </div>
          <Field label="E-mail">
            {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" />}
          </Field>
          <Field label="Senha">
            {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Entrar
          </Button>
        </form>
      </section>
    </main>
  );
}
