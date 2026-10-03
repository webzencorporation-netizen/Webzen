import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BillingInterval } from '@botsaas/shared';
import {
  BillingSignatureError,
  type BillingProvider,
  type PaymentMethodSummary,
  type ProviderCheckout,
  type ProviderEvent,
  type ProviderInvoice,
  type ProviderPrice,
  type ProviderSubscription,
} from './provider';

const MOCK_WEBHOOK_SECRET = 'mock-billing-webhook-secret';
const DAY_MS = 24 * 3600_000;

/**
 * Gateway simulado para testes e desenvolvimento sem Stripe (recusado em produção).
 * Guarda preços, clientes, assinaturas e faturas em memória e assina os webhooks com HMAC,
 * para o mesmo caminho de validação de produção ser exercitado.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock' as const;
  readonly livemode = false;
  readonly prices = new Map<string, ProviderPrice>();
  readonly subscriptions = new Map<string, ProviderSubscription>();
  readonly invoices = new Map<string, ProviderInvoice>();
  readonly checkouts = new Map<
    string,
    ProviderCheckout & { priceId: string; trialEnd: Date | null }
  >();
  readonly customers = new Map<string, { email: string; name: string; companyId: string }>();
  readonly calls: string[] = [];

  reset(): void {
    this.prices.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.checkouts.clear();
    this.customers.clear();
    this.calls.length = 0;
  }

  definePrice(
    id: string,
    unitAmountCents: number,
    interval: BillingInterval,
    currency = 'BRL',
  ): void {
    this.prices.set(id, { id, unitAmountCents, interval, currency, active: true });
  }

  /** Corpo + cabeçalho de assinatura de um evento simulado. */
  signEvent(event: { id?: string; type: string; objectId: string; livemode?: boolean }): {
    body: string;
    signature: string;
  } {
    const body = JSON.stringify({
      id: event.id ?? `evt_${randomUUID()}`,
      type: event.type,
      livemode: event.livemode ?? false,
      data: { object: { id: event.objectId } },
    });
    return {
      body,
      signature: createHmac('sha256', MOCK_WEBHOOK_SECRET).update(body).digest('hex'),
    };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent {
    const expected = createHmac('sha256', MOCK_WEBHOOK_SECRET).update(rawBody).digest();
    const received = Buffer.from(signature ?? '', 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new BillingSignatureError();
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      type: string;
      livemode: boolean;
      data: { object: { id: string } };
    };
    const kind = event.type.startsWith('customer.subscription.')
      ? 'subscription'
      : event.type.startsWith('invoice.')
        ? 'invoice'
        : event.type.startsWith('checkout.session.')
          ? 'checkout'
          : 'other';
    return {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      objectKind: kind,
      objectId: event.data.object.id,
    };
  }

  async getPrice(priceId: string): Promise<ProviderPrice> {
    const price = this.prices.get(priceId);
    if (!price) throw new Error(`Preço ${priceId} inexistente no gateway simulado.`);
    return price;
  }

  async getSubscription(id: string) {
    return this.subscriptions.get(id) ?? null;
  }

  async getInvoice(id: string) {
    return this.invoices.get(id) ?? null;
  }

  async getCheckout(id: string) {
    return this.checkouts.get(id) ?? null;
  }

  async createCustomer(input: { email: string; name: string; companyId: string }) {
    this.calls.push('createCustomer');
    const id = `cus_${randomUUID().slice(0, 8)}`;
    this.customers.set(id, input);
    return id;
  }

  async createCheckout(input: {
    customerId: string;
    priceId: string;
    companyId: string;
    successUrl: string;
    cancelUrl: string;
    trialEnd: Date | null;
  }) {
    this.calls.push(`createCheckout:${input.priceId}`);
    const id = `cs_${randomUUID().slice(0, 8)}`;
    this.checkouts.set(id, {
      id,
      customerId: input.customerId,
      subscriptionId: null,
      companyId: input.companyId,
      livemode: false,
      priceId: input.priceId,
      trialEnd: input.trialEnd,
    });
    return { id, url: `https://checkout.mock/${id}` };
  }

  /**
   * Simula o cliente pagando o checkout: cria a assinatura ativa (ou em teste) e a primeira
   * fatura paga. Devolve os eventos que a Stripe enviaria.
   */
  completeCheckout(checkoutId: string, now: Date = new Date()) {
    const checkout = this.checkouts.get(checkoutId);
    if (!checkout) throw new Error('checkout inexistente');
    const price = this.prices.get(checkout.priceId);
    const subscriptionId = `sub_${randomUUID().slice(0, 8)}`;
    const periodEnd = new Date(now.getTime() + (price?.interval === 'YEARLY' ? 365 : 30) * DAY_MS);
    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      customerId: checkout.customerId ?? '',
      status: checkout.trialEnd ? 'TRIALING' : 'ACTIVE',
      priceId: checkout.priceId,
      currentPeriodStart: now,
      currentPeriodEnd: checkout.trialEnd ?? periodEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      canceledAt: null,
      trialEnd: checkout.trialEnd,
      companyId: checkout.companyId,
      livemode: false,
    });
    checkout.subscriptionId = subscriptionId;
    const invoiceId = this.addInvoice(
      subscriptionId,
      checkout.trialEnd ? 0 : (price?.unitAmountCents ?? 0),
      'PAID',
      now,
    );
    return [
      { type: 'checkout.session.completed', objectId: checkoutId },
      { type: 'customer.subscription.created', objectId: subscriptionId },
      { type: 'invoice.paid', objectId: invoiceId },
    ];
  }

  addInvoice(
    subscriptionId: string,
    amountCents: number,
    status: ProviderInvoice['status'],
    now: Date = new Date(),
  ): string {
    const subscription = this.subscriptions.get(subscriptionId);
    const id = `in_${randomUUID().slice(0, 8)}`;
    this.invoices.set(id, {
      id,
      customerId: subscription?.customerId ?? null,
      subscriptionId,
      number: `MOCK-${this.invoices.size + 1}`,
      status,
      currency: 'BRL',
      amountDueCents: amountCents,
      amountPaidCents: status === 'PAID' ? amountCents : 0,
      discountCents: 0,
      priceId: subscription?.priceId ?? null,
      periodStart: subscription?.currentPeriodStart ?? now,
      periodEnd: subscription?.currentPeriodEnd ?? now,
      hostedUrl: `https://invoice.mock/${id}`,
      pdfUrl: `https://invoice.mock/${id}.pdf`,
      paymentId: status === 'PAID' ? `pi_${randomUUID().slice(0, 8)}` : null,
      paidAt: status === 'PAID' ? now : null,
      issuedAt: now,
      livemode: false,
    });
    return id;
  }

  async createPortal(input: { customerId: string; returnUrl: string }) {
    this.calls.push('createPortal');
    return { url: `https://billing.mock/portal/${input.customerId}` };
  }

  async changePrice(subscriptionId: string, priceId: string) {
    this.calls.push(`changePrice:${priceId}`);
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error('assinatura inexistente');
    subscription.priceId = priceId;
    return subscription;
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
    this.calls.push(`setCancelAtPeriodEnd:${cancel}`);
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error('assinatura inexistente');
    subscription.cancelAtPeriodEnd = cancel;
    subscription.cancelAt = cancel ? subscription.currentPeriodEnd : null;
    return subscription;
  }

  async getPaymentMethod(): Promise<PaymentMethodSummary | null> {
    return { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 };
  }
}
