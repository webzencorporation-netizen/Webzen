'use client';

import { BUSINESS_TEMPLATE_KEYS, type BillingInterval } from '@botsaas/shared';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell, FormAlert } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { intervalFromParam, priceFor, usePublicPlans } from '@/features/billing/plans';
import { templateLabels } from '@/i18n/pt-BR';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';

const PASSWORD_MIN = 10;

export function SignupForm() {
  const params = useSearchParams();
  const plans = usePublicPlans();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    companyName: '',
    templateKey: 'GENERAL',
    acceptTerms: false,
  });
  const [planKey, setPlanKey] = useState(params.get('plano')?.toUpperCase() ?? '');
  const [interval, setBillingInterval] = useState<BillingInterval>(intervalFromParam(params.get('periodo')));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const selected = plans.data?.find((plan) => plan.key === planKey) ?? plans.data?.find((plan) => plan.highlight) ?? plans.data?.[0];
  const set = (field: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Informe seu nome.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Informe um e-mail válido.';
    if (form.password.length < PASSWORD_MIN) next.password = `Use pelo menos ${PASSWORD_MIN} caracteres.`;
    if (form.companyName.trim().length < 2) next.companyName = 'Informe o nome da empresa.';
    if (!form.acceptTerms) next.acceptTerms = 'É preciso aceitar os termos para continuar.';
    return next;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setLoading(true);
    try {
      await api.post('/auth/signup', {
        ...form,
        planKey: selected?.key ?? null,
        interval,
        referralCode: params.get('ref'),
      });
      setSentTo(form.email.trim().toLowerCase());
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && error.details) setFailure('Revise os dados do formulário.');
      else setFailure(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="Confira seu e-mail" description="Falta só confirmar o endereço para ativar a conta.">
        <div className="space-y-5">
          <div className="flex gap-3 rounded-xl border border-border bg-surface p-4">
            <MailCheck className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
            <p className="text-sm text-slate-700">
              Enviamos um link de confirmação para <strong className="text-foreground">{sentTo}</strong>. Ele vale por 48 horas.
            </p>
          </div>
          <p className="text-sm text-muted">Não chegou? Veja a caixa de spam ou peça outro link na tela de login.</p>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/login">Ir para o login</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const price = selected ? priceFor(selected, interval) : null;
  return (
    <AuthShell
      title="Criar conta"
      description="Configure o atendimento da sua empresa em poucos minutos."
      footer={
        <>
          Já tem conta?{' '}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Seu nome" error={errors.name}>
          {(id) => <Input id={id} autoComplete="name" value={form.name} onChange={(event) => set('name')(event.target.value)} aria-invalid={Boolean(errors.name)} />}
        </Field>
        <Field label="E-mail de trabalho" error={errors.email}>
          {(id) => <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(event) => set('email')(event.target.value)} placeholder="voce@empresa.com.br" aria-invalid={Boolean(errors.email)} />}
        </Field>
        <Field label="Senha" error={errors.password} hint={`Pelo menos ${PASSWORD_MIN} caracteres.`}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={(event) => set('password')(event.target.value)} aria-invalid={Boolean(errors.password)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da empresa" error={errors.companyName}>
            {(id) => <Input id={id} autoComplete="organization" value={form.companyName} onChange={(event) => set('companyName')(event.target.value)} aria-invalid={Boolean(errors.companyName)} />}
          </Field>
          <Field label="Tipo de negócio">
            {(id) => (
              <Select id={id} value={form.templateKey} onChange={(event) => set('templateKey')(event.target.value)}>
                {BUSINESS_TEMPLATE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {templateLabels[key]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {plans.data && plans.data.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plano">
              {(id) => (
                <Select id={id} value={selected?.key ?? ''} onChange={(event) => setPlanKey(event.target.value)}>
                  {plans.data.map((plan) => (
                    <option key={plan.key} value={plan.key}>
                      {plan.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Pagamento" hint={price !== null ? `${formatMoneyCents(price)} ${interval === 'YEARLY' ? 'por ano' : 'por mês'}` : undefined}>
              {(id) => (
                <Select id={id} value={interval} onChange={(event) => setBillingInterval(event.target.value as BillingInterval)}>
                  <option value="MONTHLY">Mensal</option>
                  {selected?.priceYearlyCents !== null ? <option value="YEARLY">Anual</option> : null}
                </Select>
              )}
            </Field>
          </div>
        ) : null}
        <div className="space-y-1">
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border accent-brand-600" checked={form.acceptTerms} onChange={(event) => set('acceptTerms')(event.target.checked)} aria-invalid={Boolean(errors.acceptTerms)} />
            <span>
              Li e aceito os{' '}
              <Link href="/termos" target="_blank" className="text-brand-700 underline">
                Termos de Uso
              </Link>{' '}
              e a{' '}
              <Link href="/privacidade" target="_blank" className="text-brand-700 underline">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms ? (
            <p className="text-xs text-red-600" role="alert">
              {errors.acceptTerms}
            </p>
          ) : null}
        </div>
        {failure ? <FormAlert>{failure}</FormAlert> : null}
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Criar conta
        </Button>
        <p className="text-center text-xs text-muted">O pagamento é feito depois, dentro do painel. Você confirma o plano antes de qualquer cobrança.</p>
      </form>
    </AuthShell>
  );
}
