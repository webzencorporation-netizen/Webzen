/**
 * Encaminhador de webhooks da Stripe para desenvolvimento local (alternativa à Stripe CLI).
 * Busca os eventos novos da conta de TESTE pela API, assina cada um com STRIPE_WEBHOOK_SECRET
 * (o mesmo formato da Stripe) e envia para a API local, como faria `stripe listen`.
 * Só aceita chave `sk_test_`/`rk_test_`: em produção a Stripe entrega direto no endpoint público.
 *
 *   pnpm stripe:forward                       # envia para http://localhost:4000/webhooks/stripe
 *   pnpm stripe:forward --to http://localhost:4200/webhooks/stripe
 */
import Stripe from 'stripe';

const EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
];
const POLL_MS = 2000;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
if (!/^(sk|rk)_test_/.test(secretKey)) {
  process.stderr.write('STRIPE_SECRET_KEY precisa ser de teste (sk_test_...). Nada foi enviado.\n');
  process.exit(1);
}
if (!webhookSecret.startsWith('whsec_')) {
  process.stderr.write('STRIPE_WEBHOOK_SECRET (whsec_...) ausente no .env.\n');
  process.exit(1);
}

const target =
  argValue('--to') ?? `http://localhost:${process.env.API_PORT ?? '4000'}/webhooks/stripe`;
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(target)) {
  process.stderr.write('O destino precisa ser a API local (http://localhost:...).\n');
  process.exit(1);
}

const stripe = new Stripe(secretKey);
const seen = new Set<string>();
// Só eventos criados a partir de agora (mesmo comportamento de `stripe listen`).
let since = Math.floor(Date.now() / 1000) - 1;

async function forward(event: Stripe.Event): Promise<void> {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  process.stdout.write(`${new Date().toISOString()}  ${event.type}  ${event.id}  → ${response.status}\n`);
}

async function poll(): Promise<void> {
  const events: Stripe.Event[] = [];
  for await (const event of stripe.events.list({
    created: { gte: since },
    types: EVENT_TYPES,
    limit: 100,
  })) {
    if (!seen.has(event.id)) events.push(event);
  }
  // A API lista do mais novo para o mais antigo; a entrega segue a ordem de criação.
  for (const event of events.reverse()) {
    seen.add(event.id);
    since = Math.max(since, event.created - 1);
    try {
      await forward(event);
    } catch (error) {
      seen.delete(event.id);
      process.stderr.write(`Falha ao enviar ${event.id}: ${(error as Error).message}\n`);
    }
  }
}

process.stdout.write(`Encaminhando eventos da Stripe (teste) para ${target}. Ctrl+C para parar.\n`);
for (;;) {
  try {
    await poll();
  } catch (error) {
    process.stderr.write(`Falha ao consultar a Stripe: ${(error as Error).message}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
