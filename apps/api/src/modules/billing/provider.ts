import type { BillingInterval, InvoiceStatus, SubscriptionStatus } from '@botsaas/shared';

/**
 * Contrato do gateway de cobrança, neutro em relação ao fornecedor. O domínio (planos,
 * assinaturas, faturas) só conversa com este contrato; trocar a Stripe por outro gateway
 * é escrever outra implementação, sem mexer em rotas e regras.
 */
export interface ProviderPrice {
  id: string;
  unitAmountCents: number | null;
  currency: string;
  interval: BillingInterval | null;
  active: boolean;
}

export interface ProviderSubscription {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  canceledAt: Date | null;
  trialEnd: Date | null;
  /** ID da empresa gravado pelo servidor ao criar o checkout. */
  companyId: string | null;
  livemode: boolean;
}

export interface ProviderInvoice {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  number: string | null;
  status: InvoiceStatus;
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  discountCents: number;
  priceId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  paymentId: string | null;
  paidAt: Date | null;
  issuedAt: Date;
  livemode: boolean;
}

export interface ProviderCheckout {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  companyId: string | null;
  livemode: boolean;
}

export type ProviderObjectKind = 'subscription' | 'invoice' | 'checkout' | 'other';

export interface ProviderEvent {
  id: string;
  type: string;
  livemode: boolean;
  objectKind: ProviderObjectKind;
  objectId: string | null;
}

export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

export class BillingSignatureError extends Error {
  constructor(message = 'Assinatura do webhook inválida.') {
    super(message);
    this.name = 'BillingSignatureError';
  }
}

export interface BillingProvider {
  readonly name: 'stripe' | 'mock';
  /** Modo da chave configurada: eventos do outro modo são ignorados (teste ≠ produção). */
  readonly livemode: boolean;
  /** Valida a assinatura sobre o corpo bruto; lança BillingSignatureError se inválida. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent;
  getPrice(priceId: string): Promise<ProviderPrice>;
  getSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;
  getInvoice(invoiceId: string): Promise<ProviderInvoice | null>;
  getCheckout(checkoutId: string): Promise<ProviderCheckout | null>;
  createCustomer(input: { email: string; name: string; companyId: string }): Promise<string>;
  createCheckout(input: {
    customerId: string;
    priceId: string;
    companyId: string;
    successUrl: string;
    cancelUrl: string;
    /** Mantém o restante do teste grátis já iniciado no WebZen. */
    trialEnd: Date | null;
  }): Promise<{ id: string; url: string }>;
  createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  changePrice(subscriptionId: string, priceId: string): Promise<ProviderSubscription>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<ProviderSubscription>;
  getPaymentMethod(customerId: string): Promise<PaymentMethodSummary | null>;
}
