import { FEATURE_FLAGS, FEATURE_LABELS, type UsageMetric } from '@botsaas/shared';
import { Check, Minus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pricing } from '@/components/site/pricing';
import { fetchPublicPlans } from '@/lib/public-api';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Preços',
  description: 'Planos Starter, Pro e Business do WebZen, com pagamento mensal ou anual. Compare limites e recursos.',
  alternates: { canonical: '/precos' },
};

const numberFormat = new Intl.NumberFormat('pt-BR');

const LIMIT_ROWS: { metric: UsageMetric; label: string; format?: (value: number) => string }[] = [
  { metric: 'MESSAGES_PER_MONTH', label: 'Mensagens enviadas por mês' },
  { metric: 'AI_CALLS_PER_MONTH', label: 'Respostas da IA por mês' },
  { metric: 'USERS', label: 'Usuários na equipe' },
  { metric: 'WHATSAPP_NUMBERS', label: 'Números de WhatsApp' },
  { metric: 'AUTOMATIONS', label: 'Automações ativas' },
  { metric: 'STORAGE_MB', label: 'Armazenamento', format: (value) => (value >= 1024 ? `${numberFormat.format(value / 1024)} GB` : `${value} MB`) },
];

/** Recursos à venda (o white label é reservado para planos futuros). */
const FEATURE_ROWS = FEATURE_FLAGS.filter((flag) => flag !== 'WHITE_LABEL');

const BILLING_FAQ = [
  { q: 'Posso trocar de plano depois?', a: 'Sim, a qualquer momento pelo painel. No upgrade, você paga só a diferença proporcional do período. No downgrade, o uso atual precisa caber nos limites do plano menor.' },
  { q: 'Como cancelo?', a: 'Em Configurações → Assinatura. O plano continua funcionando até o fim do período já pago, e você pode desfazer o cancelamento até lá.' },
  { q: 'Vocês aceitam cupom de desconto?', a: 'Sim. O campo de cupom aparece na tela de pagamento.' },
  { q: 'O custo do WhatsApp está incluído?', a: 'Não. As tarifas do WhatsApp Business são definidas e cobradas pela Meta, conforme a tabela oficial dela. A assinatura do WebZen cobre a plataforma e a IA dentro dos limites do plano.' },
];

export default async function PricingPage() {
  const plans = await fetchPublicPlans();
  return (
    <>
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">Preços</h1>
            <p className="mt-4 text-lg text-muted">Escolha pelo volume de atendimento da sua empresa. No anual, 12 meses pelo preço de 10.</p>
          </div>
          <div className="mt-12">
            {plans && plans.length > 0 ? (
              <Pricing plans={plans} />
            ) : (
              <p className="rounded-xl border border-border bg-surface p-6 text-center text-muted">
                Não foi possível carregar os preços agora. Tente de novo em instantes ou{' '}
                <Link href="/cadastro" className="text-brand-700 underline">
                  crie sua conta
                </Link>{' '}
                e escolha o plano no painel.
              </p>
            )}
          </div>
        </div>
      </section>

      {plans && plans.length > 0 ? (
        <section className="border-t border-border bg-surface py-16 sm:py-20" aria-labelledby="comparativo">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="comparativo" className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Comparativo completo
            </h2>
            <div className="mt-8 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
                      Recurso
                    </th>
                    {plans.map((plan) => (
                      <th key={plan.key} scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
                        {plan.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {LIMIT_ROWS.map((row) => (
                    <tr key={row.metric}>
                      <th scope="row" className="px-4 py-3 text-left font-normal text-slate-700">
                        {row.label}
                      </th>
                      {plans.map((plan) => {
                        const value = plan.limits[row.metric];
                        return (
                          <td key={plan.key} className="px-4 py-3 tabular-nums text-foreground">
                            {value === null || value === undefined ? 'Ilimitado' : row.format ? row.format(value) : numberFormat.format(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {FEATURE_ROWS.map((flag) => (
                    <tr key={flag}>
                      <th scope="row" className="px-4 py-3 text-left font-normal text-slate-700">
                        {FEATURE_LABELS[flag]}
                      </th>
                      {plans.map((plan) => {
                        const included = plan.features.some((feature) => feature.flag === flag);
                        return (
                          <td key={plan.key} className="px-4 py-3">
                            {included ? <Check className="h-4 w-4 text-brand-600" aria-label="Incluído" /> : <Minus className="h-4 w-4 text-slate-300" aria-label="Não incluído" />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="px-4 py-3 text-left font-normal text-slate-700">
                      Suporte
                    </th>
                    {plans.map((plan) => (
                      <td key={plan.key} className="px-4 py-3 text-foreground">
                        {plan.features.some((feature) => feature.flag === 'PRIORITY_SUPPORT') ? 'Prioritário' : 'Por e-mail'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Dúvidas sobre cobrança</h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {BILLING_FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-medium text-foreground marker:hidden">
                  {item.q}
                  <span className="text-2xl leading-none text-brand-600 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
