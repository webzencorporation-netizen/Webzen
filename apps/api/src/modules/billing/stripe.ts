import type { InvoiceStatus, SubscriptionStatus } from '@botsaas/shared';
import Stripe from 'stripe';
import {
  BillingSignatureError,
  type BillingProvider,
  type PaymentMethodSummary,
  type ProviderCheckout,
  type ProviderEvent,
  type ProviderInvoice,
  type ProviderObjectKind,
  type ProviderPrice,
  type ProviderSubscription,
} from './provider';

const SUBSCRIPTION_STATUS: Record<string, SubscriptionStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'UNPAID',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELLED',
  canceled: 'CANCELLED',
  paused: 'PAUSED',
};

const INVOICE_STATUS: Record<string, InvoiceStatus> = {
  draft: 'DRAFT',
  open: 'OPEN',
  paid: 'PAID',
  void: 'VOID',
  uncollectible: 'UNCOLLECTIBLE',
};

const date = (seconds: number | null | undefined): Date | null =>
  typeof seconds === 'number' ? new Date(seconds * 1000) : null;

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value === null || value === undefined ? null : typeof value === 'string' ? value : value.id;

function objectKind(type: string): ProviderObjectKind {
  if (type.startsWith('customer.subscription.')) return 'subscription';
  if (type.startsWith('invoice.')) return 'invoice';
  if (type.startsWith('checkout.session.')) return 'checkout';
  return 'other';
}

export interface StripeBillingConfig {
  secretKey: string;
  webhookSecret: string;
  /** Limite por chamada; um gateway lento não pode prender a requisição do painel. */
  timeoutMs?: number;
}

/** Stripe (assinaturas recorrentes). Versão de API fixada pela SDK instalada. */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  readonly livemode: boolean;
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeBillingConfig) {
    this.livemode = /^(sk|rk)_live_/.test(config.secretKey);
    this.stripe = new Stripe(config.secretKey, {
      timeout: config.timeoutMs ?? 20_000,
      // A SDK só repete com chave de idempotência própria: seguro para POSTs.
      maxNetworkRetries: 2,
      appInfo: { name: 'WebZen' },
    });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent {
    if (!signature) throw new BillingSignatureError('Cabeçalho Stripe-Signature ausente.');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret);
    } catch {
      throw new BillingSignatureError();
    }
    const object = event.data.object as { id?: string };
    return {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      objectKind: objectKind(event.type),
      objectId: typeof object.id === 'string' ? object.id : null,
    };
  }

  async getPrice(priceId: string): Promise<ProviderPrice> {
    const price = await this.stripe.prices.retrieve(priceId);
    const interval = price.recurring?.interval;
    return {
      id: price.id,
      unitAmountCents: price.unit_amount,
      currency: price.currency.toUpperCase(),
      interval:
        price.recurring?.interval_count === 1
          ? interval === 'month'
            ? 'MONTHLY'
            : interval === 'year'
              ? 'YEARLY'
              : null
          : null,
      active: price.active,
    };
  }

  private mapSubscription(subscription: Stripe.Subscription): ProviderSubscription {
    const item = subscription.items.data[0];
    return {
      id: subscription.id,
      customerId: idOf(subscription.customer) ?? '',
      status: SUBSCRIPTION_STATUS[subscription.status] ?? 'INCOMPLETE',
      priceId: item?.price.id ?? null,
      currentPeriodStart: date(item?.current_period_start),
      currentPeriodEnd: date(item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: date(subscription.cancel_at),
      canceledAt: date(subscription.canceled_at),
      trialEnd: date(subscription.trial_end),
      companyId: subscription.metadata.companyId ?? null,
      livemode: subscription.livemode,
    };
  }

  async getSubscription(subscriptionId: string): Promise<ProviderSubscription | null> {
    try {
      return this.mapSubscription(await this.stripe.subscriptions.retrieve(subscriptionId));
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404)
        return null;
      throw error;
    }
  }

  async getInvoice(invoiceId: string): Promise<ProviderInvoice | null> {
    let invoice: Stripe.Invoice;
    try {
      invoice = await this.stripe.invoices.retrieve(invoiceId, { expand: ['payments'] });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404)
        return null;
      throw error;
    }
    const line = invoice.lines.data.find((item) => item.pricing?.price_details?.price);
    const payment = invoice.payments?.data.find((item) => item.status === 'paid');
    const discountCents = (invoice.total_discount_amounts ?? []).reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    return {
      id: invoice.id,
      customerId: idOf(invoice.customer),
      subscriptionId: idOf(invoice.parent?.subscription_details?.subscription ?? null),
      number: invoice.number,
      status: INVOICE_STATUS[invoice.status ?? 'draft'] ?? 'DRAFT',
      currency: invoice.currency.toUpperCase(),
      amountDueCents: invoice.amount_due,
      amountPaidCents: invoice.amount_paid,
      discountCents,
      priceId: idOf(line?.pricing?.price_details?.price ?? null),
      periodStart: date(line?.period.start ?? invoice.period_start),
      periodEnd: date(line?.period.end ?? invoice.period_end),
      hostedUrl: invoice.hosted_invoice_url ?? null,
      pdfUrl: invoice.invoice_pdf ?? null,
      paymentId: idOf(payment?.payment.payment_intent ?? payment?.payment.charge ?? null),
      paidAt: date(invoice.status_transitions.paid_at),
      issuedAt: date(invoice.status_transitions.finalized_at ?? invoice.created) ?? new Date(),
      livemode: invoice.livemode,
    };
  }

  async getCheckout(checkoutId: string): Promise<ProviderCheckout | null> {
    const session = await this.stripe.checkout.sessions.retrieve(checkoutId);
    return {
      id: session.id,
      customerId: idOf(session.customer),
      subscriptionId: idOf(session.subscription),
      companyId: session.client_reference_id ?? session.metadata?.companyId ?? null,
      livemode: session.livemode,
    };
  }

  async createCustomer(input: { email: string; name: string; companyId: string }) {
    const customer = await this.stripe.customers.create(
      { email: input.email, name: input.name, metadata: { companyId: input.companyId } },
      // Retry do painel não cria dois clientes para a mesma empresa.
      { idempotencyKey: `customer-${input.companyId}` },
    );
    return customer.id;
  }

  async createCheckout(input: {
    customerId: string;
    priceId: string;
    companyId: string;
    successUrl: string;
    cancelUrl: string;
    trialEnd: Date | null;
  }) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      client_reference_id: input.companyId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      // Cupons: códigos promocionais criados na Stripe (validade, limite, planos).
      allow_promotion_codes: true,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'pt-BR',
      metadata: { companyId: input.companyId },
      subscription_data: {
        metadata: { companyId: input.companyId },
        ...(input.trialEnd ? { trial_end: Math.floor(input.trialEnd.getTime() / 1000) } : {}),
      },
    });
    if (!session.url) throw new Error('A Stripe não devolveu a URL do checkout.');
    return { id: session.id, url: session.url };
  }

  async createPortal(input: { customerId: string; returnUrl: string }) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      locale: 'pt-BR',
    });
    return { url: session.url };
  }

  async changePrice(subscriptionId: string, priceId: string) {
    const current = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = current.items.data[0];
    if (!item) throw new Error('Assinatura sem item na Stripe.');
    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
    });
    return this.mapSubscription(updated);
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancel,
    });
    return this.mapSubscription(updated);
  }

  async getPaymentMethod(customerId: string): Promise<PaymentMethodSummary | null> {
    const customer = await this.stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if (customer.deleted) return null;
    let method = customer.invoice_settings.default_payment_method;
    if (!method) {
      // O Checkout em modo assinatura guarda o cartão na assinatura, não no cliente.
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 1,
        expand: ['data.default_payment_method'],
      });
      method = subscriptions.data[0]?.default_payment_method ?? null;
    }
    if (!method || typeof method === 'string' || !method.card) return null;
    return {
      brand: method.card.brand,
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    };
  }
}
