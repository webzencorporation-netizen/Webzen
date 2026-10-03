'use client';

import type { BillingInterval, UsageMetric } from '@botsaas/shared';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { intervalToParam, priceFor, type PublicPlan } from '@/features/billing/plans';
import { cn } from '@/lib/cn';
import { formatPriceCents } from '@/lib/format';

const numberFormat = new Intl.NumberFormat('pt-BR');

/** Limites mostrados no card, na ordem em que o cliente decide. */
const CARD_LIMITS: { metric: UsageMetric; label: (value: string) => string; unlimited: string }[] = [
  { metric: 'MESSAGES_PER_MONTH', label: (value) => `${value} mensagens por mês`, unlimited: 'Mensagens ilimitadas' },
  { metric: 'AI_CALLS_PER_MONTH', label: (value) => `${value} respostas da IA por mês`, unlimited: 'Respostas da IA ilimitadas' },
  { metric: 'USERS', label: (value) => `${value} usuários na equipe`, unlimited: 'Usuários ilimitados' },
  { metric: 'WHATSAPP_NUMBERS', label: (value) => `${value} ${value === '1' ? 'número' : 'números'} de WhatsApp`, unlimited: 'Números de WhatsApp ilimitados' },
  { metric: 'AUTOMATIONS', label: (value) => `${value} automações ativas`, unlimited: 'Automações ilimitadas' },
];

function limitText(plan: PublicPlan, item: (typeof CARD_LIMITS)[number]): string {
  const value = plan.limits[item.metric];
  return value === null || value === undefined ? item.unlimited : item.label(numberFormat.format(value));
}

export function IntervalToggle({ value, onChange, savingsPercent }: { value: BillingInterval; onChange: (value: BillingInterval) => void; savingsPercent: number | null }) {
  return (
    <div role="radiogroup" aria-label="Período de pagamento" className="inline-flex rounded-full bg-surface p-1 ring-1 ring-border">
      {(['MONTHLY', 'YEARLY'] as const).map((interval) => (
        <button
          key={interval}
          role="radio"
          aria-checked={value === interval}
          onClick={() => onChange(interval)}
          className={cn(
            'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            value === interval ? 'bg-ink text-white shadow-sm' : 'text-slate-600 hover:text-foreground',
          )}
        >
          {interval === 'MONTHLY' ? 'Mensal' : 'Anual'}
          {interval === 'YEARLY' && savingsPercent ? (
            <span className={cn('ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold', value === 'YEARLY' ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700')}>
              −{savingsPercent}%
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Pricing({ plans }: { plans: PublicPlan[] }) {
  const [interval, setBillingInterval] = useState<BillingInterval>('MONTHLY');
  const savings = Math.max(0, ...plans.map((plan) => plan.yearlySavings?.percent ?? 0)) || null;

  return (
    <div>
      <div className="flex justify-center">
        <IntervalToggle value={interval} onChange={setBillingInterval} savingsPercent={savings} />
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const price = priceFor(plan, interval);
          const previous = plans[index - 1];
          const newFeatures = plan.features.filter((feature) => !previous?.features.some((item) => item.flag === feature.flag));
          return (
            <section
              key={plan.key}
              aria-labelledby={`plano-${plan.key}`}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-surface p-6',
                plan.highlight ? 'border-brand-600 shadow-[var(--shadow-overlay)] ring-1 ring-brand-600' : 'border-border',
              )}
            >
              {plan.highlight ? <p className="absolute -top-3 left-6 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white">Mais escolhido</p> : null}
              <h3 id={`plano-${plan.key}`} className="font-display text-xl font-bold text-foreground">
                {plan.name}
              </h3>
              <p className="mt-1 min-h-[2.5rem] text-sm text-muted">{plan.tagline}</p>
              <div className="mt-5">
                {price === null ? (
                  <p className="text-sm text-muted">Disponível só no mensal.</p>
                ) : interval === 'MONTHLY' ? (
                  <p className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold tracking-tight text-foreground">{formatPriceCents(price)}</span>
                    <span className="text-sm text-muted">/mês</span>
                  </p>
                ) : (
                  <>
                    <p className="flex items-baseline gap-1">
                      <span className="font-display text-4xl font-bold tracking-tight text-foreground">{formatPriceCents(price)}</span>
                      <span className="text-sm text-muted">/ano</span>
                    </p>
                    <p className="mt-1 text-sm text-brand-700">
                      Equivale a {formatPriceCents(Math.round(price / 12))}/mês
                      {plan.yearlySavings ? ` · economia de ${formatPriceCents(plan.yearlySavings.cents)}` : ''}
                    </p>
                  </>
                )}
              </div>
              <Button asChild className="mt-6 w-full" variant={plan.highlight ? 'primary' : 'secondary'} size="lg">
                <Link href={`/cadastro?plano=${plan.key.toLowerCase()}&periodo=${intervalToParam(interval)}`}>Assinar o {plan.name}</Link>
              </Button>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
                {CARD_LIMITS.map((item) => (
                  <li key={item.metric} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    {limitText(plan, item)}
                  </li>
                ))}
              </ul>
              <div className="mt-5 border-t border-border pt-5">
                <p className="text-xs font-medium text-muted">{previous ? `Tudo do ${previous.name}, mais:` : 'Inclui:'}</p>
                <ul className="mt-2.5 space-y-2 text-sm text-slate-700">
                  {newFeatures.map((feature) => (
                    <li key={feature.flag} className="flex gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {feature.label}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
