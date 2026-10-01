import { systemDb, type Plan, type Prisma } from '@botsaas/database';
import {
  ConflictError,
  FEATURE_LABELS,
  formatCentsBRL,
  IntegrationError,
  NotFoundError,
  planPriceCents,
  USAGE_METRIC_LABELS,
  ValidationError,
  type BillingInterval,
  type UsageMetric,
} from '@botsaas/shared';
import type { AppContainer } from '../../container';
import type { CompanyScope } from '../../context';
import { audit, auditPlatform } from '../../lib/audit';
import { getOwnCompany, updateOwnCompany } from '../../lib/company-record';
import { paginated, toSkipTake, type PaginationQuery } from '../../lib/http';
import { JOB_RETRY_POLICY } from '../../queues/types';
import { queueEmail } from '../email/service';
import { emailTemplates } from '../email/templates';
import { getUsageStatus } from '../usage/limits';
import type {
  BillingProvider,
  ProviderEvent,
  ProviderInvoice,
  ProviderSubscription,
} from './provider';

/** Métricas de capacidade: um downgrade não pode deixar a empresa acima do novo limite. */
const CAPACITY_METRICS: UsageMetric[] = ['USERS', 'WHATSAPP_NUMBERS', 'AUTOMATIONS', 'STORAGE_MB'];

export function requireBilling(container: AppContainer): BillingProvider {
  const provider = container.providers.billing;
  if (!provider) {
    throw new ValidationError(
      'A contratação online ainda não está disponível. Fale com o suporte.',
    );
  }
  return provider;
}

function priceIdFor(plan: Plan, interval: BillingInterval): string | null {
  return interval === 'MONTHLY' ? plan.stripePriceMonthlyId : plan.stripePriceYearlyId;
}

/**
 * O valor cobrado vem do preço oficial cadastrado no gateway, e ele precisa bater com o
 * plano (valor, moeda e período). Divergência = configuração errada: recusa em vez de cobrar.
 */
async function verifiedPriceId(
  container: AppContainer,
  provider: BillingProvider,
  plan: Plan,
  interval: BillingInterval,
): Promise<string> {
  const priceId = priceIdFor(plan, interval);
  const expected = planPriceCents(
    { priceMonthlyCents: plan.priceMonthlyCents, priceYearlyCents: plan.priceYearlyCents },
    interval,
  );
  if (!priceId || expected === null) {
    throw new ValidationError(
      interval === 'YEARLY'
        ? 'Este plano não tem opção anual.'
        : 'Este plano ainda não está disponível para contratação online.',
    );
  }
  const price = await provider.getPrice(priceId);
  if (
    !price.active ||
    price.currency !== plan.currency.toUpperCase() ||
    price.interval !== interval ||
    price.unitAmountCents !== expected
  ) {
    container.logger.error(
      {
        billing: 'price_mismatch',
        plan: plan.key,
        interval,
        expected,
        gateway: {
          amount: price.unitAmountCents,
          currency: price.currency,
          interval: price.interval,
          active: price.active,
        },
      },
      'Preço do gateway diverge do plano',
    );
    throw new IntegrationError(
      'O preço deste plano está em atualização. Tente novamente mais tarde.',
    );
  }
  return priceId;
}

async function findSellablePlan(planKey: string): Promise<Plan> {
  const plan = await systemDb.plan.findFirst({ where: { key: planKey, isActive: true } });
  if (!plan) throw new NotFoundError('Plano não encontrado.');
  return plan;
}

// ── Leitura (painel) ────────────────────────────────────────────────────────

export async function getBillingOverview(scope: CompanyScope) {
  const [company, subscription, usage] = await Promise.all([
    getOwnCompany(scope),
    scope.db.subscription.findFirst({ include: { plan: true } }),
    getUsageStatus(scope),
  ]);
  const provider = scope.container.providers.billing;
  let paymentMethod = null;
  if (provider && company.billingCustomerId) {
    // Informativo: se o gateway estiver lento ou fora, a tela mostra o resto.
    paymentMethod = await provider.getPaymentMethod(company.billingCustomerId).catch(() => null);
  }
  const plan = subscription?.plan ?? null;
  return {
    billingEnabled: provider !== null,
    managedBy: subscription?.externalId ? 'gateway' : subscription ? 'manual' : null,
    subscription:
      subscription && plan
        ? {
            status: subscription.status,
            interval: subscription.interval,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            cancelAt: subscription.cancelAt,
            trialEndsAt: subscription.trialEndsAt,
            priceCents: planPriceCents(
              {
                priceMonthlyCents: plan.priceMonthlyCents,
                priceYearlyCents: plan.priceYearlyCents,
              },
              subscription.interval,
            ),
            plan: {
              key: plan.key,
              name: plan.name,
              currency: plan.currency,
              features: plan.features.map((flag) => ({ flag, label: FEATURE_LABELS[flag] })),
            },
          }
        : null,
    paymentMethod,
    usage,
  };
}

export async function listInvoices(scope: CompanyScope, query: PaginationQuery) {
  const [items, total] = await Promise.all([
    scope.db.invoice.findMany({
      orderBy: { issuedAt: 'desc' },
      ...toSkipTake(query),
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        amountDueCents: true,
        amountPaidCents: true,
        discountCents: true,
        planKey: true,
        interval: true,
        periodStart: true,
        periodEnd: true,
        hostedUrl: true,
        pdfUrl: true,
        paymentId: true,
        paidAt: true,
        issuedAt: true,
      },
    }),
    scope.db.invoice.count(),
  ]);
  return paginated(items, total, query);
}

// ── Ações do cliente ────────────────────────────────────────────────────────

async function ensureCustomer(scope: CompanyScope, provider: BillingProvider): Promise<string> {
  const company = await getOwnCompany(scope);
  if (company.billingCustomerId) return company.billingCustomerId;
  const owner = await scope.db.companyMember.findFirst({
    where: { role: 'COMPANY_OWNER', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { email: true } } },
  });
  const customerId = await provider.createCustomer({
    email: company.email ?? owner?.user.email ?? '',
    name: company.legalName ?? company.name,
    companyId: company.id,
  });
  await updateOwnCompany(scope, { billingCustomerId: customerId });
  return customerId;
}

const billingUrl = (container: AppContainer, query = '') =>
  `${container.env.APP_URL}/app/settings/billing${query}`;

/** Checkout para quem ainda não tem assinatura paga no gateway (primeira contratação). */
export async function startCheckout(
  scope: CompanyScope,
  input: { planKey: string; interval: BillingInterval },
  now: Date = new Date(),
): Promise<{ url: string }> {
  const provider = requireBilling(scope.container);
  const subscription = await scope.db.subscription.findFirst();
  if (subscription?.externalId && subscription.status !== 'CANCELLED') {
    throw new ConflictError('A empresa já tem uma assinatura. Use a troca de plano.');
  }
  const plan = await findSellablePlan(input.planKey);
  const priceId = await verifiedPriceId(scope.container, provider, plan, input.interval);
  const customerId = await ensureCustomer(scope, provider);
  const trialEnd =
    subscription?.status === 'TRIALING' &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt.getTime() > now.getTime() + 3600_000
      ? subscription.trialEndsAt
      : null;
  const checkout = await provider.createCheckout({
    customerId,
    priceId,
    companyId: scope.companyId,
    successUrl: billingUrl(scope.container, '?checkout=success'),
    cancelUrl: billingUrl(scope.container, '?checkout=cancelled'),
    trialEnd,
  });
  await audit(scope, {
    action: 'billing.checkout_started',
    resourceType: 'Subscription',
    resourceId: subscription?.id ?? null,
    metadata: { planKey: plan.key, interval: input.interval },
  });
  return { url: checkout.url };
}

export async function openBillingPortal(scope: CompanyScope): Promise<{ url: string }> {
  const provider = requireBilling(scope.container);
  const company = await getOwnCompany(scope);
  if (!company.billingCustomerId) {
    throw new ValidationError('Contrate um plano para gerenciar a forma de pagamento.');
  }
  return provider.createPortal({
    customerId: company.billingCustomerId,
    returnUrl: billingUrl(scope.container),
  });
}

async function requireGatewaySubscription(scope: CompanyScope) {
  const subscription = await scope.db.subscription.findFirst({ include: { plan: true } });
  if (!subscription?.externalId || subscription.status === 'CANCELLED') {
    throw new ValidationError('A empresa não tem uma assinatura ativa para alterar.');
  }
  return subscription as typeof subscription & { externalId: string };
}

/** Upgrade/downgrade imediato, com cobrança proporcional calculada pelo gateway. */
export async function changePlan(
  scope: CompanyScope,
  input: { planKey: string; interval: BillingInterval },
) {
  const provider = requireBilling(scope.container);
  const subscription = await requireGatewaySubscription(scope);
  const plan = await findSellablePlan(input.planKey);
  if (plan.id === subscription.planId && input.interval === subscription.interval) {
    throw new ValidationError('A empresa já está neste plano.');
  }
  const limits = plan.limits as Prisma.JsonObject;
  const usage = await getUsageStatus(scope);
  const exceeded = usage.metrics.filter((metric) => {
    const limit = limits[metric.metric];
    return (
      CAPACITY_METRICS.includes(metric.metric) &&
      typeof limit === 'number' &&
      metric.current > limit
    );
  });
  if (exceeded.length > 0) {
    throw new ValidationError(
      `O plano ${plan.name} não comporta o uso atual: ${exceeded
        .map(
          (metric) =>
            `${USAGE_METRIC_LABELS[metric.metric]} (${metric.current} de ${String(limits[metric.metric])})`,
        )
        .join(', ')}. Reduza o uso antes de trocar.`,
      { details: { exceeded: exceeded.map((metric) => metric.metric) } },
    );
  }
  const priceId = await verifiedPriceId(scope.container, provider, plan, input.interval);
  const updated = await provider.changePrice(subscription.externalId, priceId);
  await syncSubscription(scope.container, updated);
  await audit(scope, {
    action: 'subscription.plan_changed',
    resourceType: 'Subscription',
    resourceId: subscription.id,
    metadata: {
      from: { plan: subscription.plan.key, interval: subscription.interval },
      to: { plan: plan.key, interval: input.interval },
    },
  });
}

export async function setCancellation(scope: CompanyScope, cancel: boolean) {
  const provider = requireBilling(scope.container);
  const subscription = await requireGatewaySubscription(scope);
  if (subscription.cancelAtPeriodEnd === cancel) {
    throw new ValidationError(
      cancel ? 'O cancelamento já está agendado.' : 'A assinatura não está cancelada.',
    );
  }
  const updated = await provider.setCancelAtPeriodEnd(subscription.externalId, cancel);
  await syncSubscription(scope.container, updated);
  await audit(scope, {
    action: cancel ? 'subscription.cancelled' : 'subscription.reactivated',
    resourceType: 'Subscription',
    resourceId: subscription.id,
  });
}

// ── Sincronização a partir do gateway ──────────────────────────────────────

async function ownersOf(companyId: string): Promise<string[]> {
  const members = await systemDb.companyMember.findMany({
    where: { companyId, isActive: true, role: 'COMPANY_OWNER', user: { isActive: true } },
    select: { user: { select: { email: true } } },
  });
  return members.map((member) => member.user.email);
}

async function planForPrice(priceId: string | null) {
  if (!priceId) return null;
  const plan = await systemDb.plan.findFirst({
    where: { OR: [{ stripePriceMonthlyId: priceId }, { stripePriceYearlyId: priceId }] },
  });
  if (!plan) return null;
  return {
    plan,
    interval: (plan.stripePriceYearlyId === priceId ? 'YEARLY' : 'MONTHLY') as BillingInterval,
  };
}

/**
 * Empresa dona de um objeto do gateway. Ordem: assinatura já vinculada → cliente já
 * vinculado → ID gravado pelo servidor no checkout (aceito só se o cliente não pertencer a
 * outra empresa).
 */
async function resolveCompanyId(input: {
  subscriptionId?: string | null;
  customerId?: string | null;
  companyId?: string | null;
}): Promise<string | null> {
  if (input.subscriptionId) {
    const bySubscription = await systemDb.subscription.findUnique({
      where: { externalId: input.subscriptionId },
      select: { companyId: true },
    });
    if (bySubscription) return bySubscription.companyId;
  }
  if (input.customerId) {
    const byCustomer = await systemDb.company.findUnique({
      where: { billingCustomerId: input.customerId },
      select: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }
  if (input.companyId) {
    const company = await systemDb.company.findUnique({
      where: { id: input.companyId },
      select: { id: true, billingCustomerId: true },
    });
    if (company && (!company.billingCustomerId || company.billingCustomerId === input.customerId)) {
      return company.id;
    }
  }
  return null;
}

async function notifyOwners(
  container: AppContainer,
  companyId: string,
  notification: {
    type: 'SYSTEM';
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    body: string;
  },
  email?: { template: string; render: () => ReturnType<(typeof emailTemplates)['paymentFailed']> },
) {
  await systemDb.notification.create({
    data: { companyId, ...notification, link: '/app/settings/billing' },
  });
  if (!email) return;
  for (const to of await ownersOf(companyId)) {
    await queueEmail(container, { to, template: email.template, email: email.render() });
  }
}

export async function syncSubscription(
  container: AppContainer,
  remote: ProviderSubscription,
): Promise<string | null> {
  const companyId = await resolveCompanyId({
    subscriptionId: remote.id,
    customerId: remote.customerId,
    companyId: remote.companyId,
  });
  if (!companyId) {
    container.logger.warn(
      { billing: 'orphan_subscription', subscriptionId: remote.id },
      'Assinatura sem empresa',
    );
    return null;
  }
  const [current, mapped, company] = await Promise.all([
    systemDb.subscription.findUnique({ where: { companyId } }),
    planForPrice(remote.priceId),
    systemDb.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, billingCustomerId: true },
    }),
  ]);
  if (!mapped) {
    container.logger.error(
      { billing: 'unknown_price', priceId: remote.priceId },
      'Preço do gateway sem plano',
    );
  }
  const planId = mapped?.plan.id ?? current?.planId;
  if (!planId) return null;
  const data = {
    planId,
    status: remote.status,
    interval: mapped?.interval ?? current?.interval ?? 'MONTHLY',
    externalId: remote.id,
    currentPeriodStart: remote.currentPeriodStart ?? current?.currentPeriodStart ?? new Date(),
    currentPeriodEnd: remote.currentPeriodEnd,
    cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
    cancelAt: remote.cancelAt,
    cancelledAt: remote.canceledAt,
    trialEndsAt: remote.trialEnd,
    externalUpdatedAt: new Date(),
  } satisfies Prisma.SubscriptionUncheckedUpdateInput;
  await systemDb.$transaction([
    systemDb.subscription.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    }),
    ...(company.billingCustomerId
      ? []
      : [
          systemDb.company.update({
            where: { id: companyId },
            data: { billingCustomerId: remote.customerId },
          }),
        ]),
  ]);

  const becameActive = remote.status === 'ACTIVE' && current?.status !== 'ACTIVE';
  if (becameActive && mapped) {
    await notifyOwners(container, companyId, {
      type: 'SYSTEM',
      severity: 'INFO',
      title: `Plano ${mapped.plan.name} ativo`,
      body: 'A assinatura está ativa e o atendimento automático está liberado.',
    });
  }
  const cancelScheduled = remote.cancelAtPeriodEnd && !current?.cancelAtPeriodEnd;
  if (
    cancelScheduled ||
    (remote.status === 'CANCELLED' &&
      current?.status !== 'CANCELLED' &&
      !current?.cancelAtPeriodEnd)
  ) {
    const endsAt = (remote.cancelAt ?? remote.currentPeriodEnd ?? new Date()).toLocaleDateString(
      'pt-BR',
      {
        timeZone: 'America/Sao_Paulo',
      },
    );
    await notifyOwners(
      container,
      companyId,
      {
        type: 'SYSTEM',
        severity: 'WARNING',
        title: 'Assinatura cancelada',
        body: `O plano vale até ${endsAt}.`,
      },
      {
        template: 'subscriptionCancelled',
        render: () =>
          emailTemplates.subscriptionCancelled({
            companyName: company.name,
            endsAt,
            url: billingUrl(container),
          }),
      },
    );
  }
  return companyId;
}

export async function syncInvoice(
  container: AppContainer,
  remote: ProviderInvoice,
  eventType: string,
): Promise<string | null> {
  const companyId = await resolveCompanyId({
    subscriptionId: remote.subscriptionId,
    customerId: remote.customerId,
  });
  if (!companyId) {
    container.logger.warn(
      { billing: 'orphan_invoice', invoiceId: remote.id },
      'Fatura sem empresa',
    );
    return null;
  }
  const [previous, mapped, company] = await Promise.all([
    systemDb.invoice.findUnique({ where: { externalId: remote.id }, select: { status: true } }),
    planForPrice(remote.priceId),
    systemDb.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
  ]);
  const data = {
    number: remote.number,
    status: remote.status,
    currency: remote.currency,
    amountDueCents: remote.amountDueCents,
    amountPaidCents: remote.amountPaidCents,
    discountCents: remote.discountCents,
    planKey: mapped?.plan.key ?? null,
    interval: mapped?.interval ?? null,
    periodStart: remote.periodStart,
    periodEnd: remote.periodEnd,
    hostedUrl: remote.hostedUrl,
    pdfUrl: remote.pdfUrl,
    paymentId: remote.paymentId,
    paidAt: remote.paidAt,
    issuedAt: remote.issuedAt,
  };
  await systemDb.invoice.upsert({
    where: { externalId: remote.id },
    create: { companyId, externalId: remote.id, ...data },
    update: data,
  });

  const amount = formatCentsBRL(
    remote.status === 'PAID' ? remote.amountPaidCents : remote.amountDueCents,
    remote.currency,
  );
  if (remote.status === 'PAID' && previous?.status !== 'PAID' && remote.amountPaidCents > 0) {
    await notifyOwners(
      container,
      companyId,
      {
        type: 'SYSTEM',
        severity: 'INFO',
        title: 'Pagamento aprovado',
        body: `Recebemos ${amount}.`,
      },
      {
        template: 'paymentSucceeded',
        render: () =>
          emailTemplates.paymentSucceeded({
            companyName: company.name,
            amount,
            planName: mapped?.plan.name ?? 'contratado',
            url: billingUrl(container),
          }),
      },
    );
  }
  if (eventType === 'invoice.payment_failed') {
    await notifyOwners(
      container,
      companyId,
      {
        type: 'SYSTEM',
        severity: 'CRITICAL',
        title: 'Pagamento recusado',
        body: `A cobrança de ${amount} não foi aprovada. Atualize a forma de pagamento.`,
      },
      {
        template: 'paymentFailed',
        render: () =>
          emailTemplates.paymentFailed({
            companyName: company.name,
            amount,
            url: billingUrl(container),
          }),
      },
    );
  }
  return companyId;
}

// ── Webhook ─────────────────────────────────────────────────────────────────

const HANDLED_EVENT_PREFIXES = ['checkout.session.completed', 'customer.subscription.', 'invoice.'];

/**
 * Registra o evento (idempotente pela unicidade provider+ID) e enfileira o processamento.
 * Evento do outro modo (teste × produção) é registrado como IGNORED e nunca processado.
 */
export async function recordBillingEvent(
  container: AppContainer,
  provider: BillingProvider,
  event: ProviderEvent,
): Promise<'queued' | 'duplicate' | 'ignored'> {
  const handled =
    event.livemode === provider.livemode &&
    HANDLED_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix)) &&
    event.objectId !== null;
  const existing = await systemDb.billingEvent.findUnique({
    where: { provider_externalId: { provider: provider.name, externalId: event.id } },
    select: { id: true, status: true },
  });
  if (existing) {
    // Reentrega de evento que ainda não foi processado: enfileira de novo com o mesmo ID.
    if (existing.status === 'RECEIVED' || existing.status === 'FAILED') {
      await container.queue.enqueue(
        'billing.event',
        { billingEventId: existing.id },
        { jobId: `billing-${existing.id}` },
      );
      return 'queued';
    }
    return 'duplicate';
  }
  try {
    const row = await systemDb.billingEvent.create({
      data: {
        provider: provider.name,
        externalId: event.id,
        type: event.type,
        livemode: event.livemode,
        objectId: event.objectId,
        status: handled ? 'RECEIVED' : 'IGNORED',
        ...(handled ? {} : { processedAt: new Date() }),
        ...(event.livemode !== provider.livemode
          ? { error: 'Modo do evento diferente do modo da chave.' }
          : {}),
      },
      select: { id: true },
    });
    if (!handled) return 'ignored';
    await container.queue.enqueue(
      'billing.event',
      { billingEventId: row.id },
      { jobId: `billing-${row.id}` },
    );
    return 'queued';
  } catch (error) {
    // Duas entregas simultâneas: a outra venceu a corrida.
    if ((error as { code?: string }).code === 'P2002') return 'duplicate';
    throw error;
  }
}

/**
 * Processa um evento relendo o objeto no gateway (fonte da verdade): a ordem de chegada
 * dos webhooks não importa e o banco não guarda o payload. Reprocessar é seguro.
 */
export async function processBillingEvent(
  container: AppContainer,
  billingEventId: string,
): Promise<void> {
  const event = await systemDb.billingEvent.findUnique({ where: { id: billingEventId } });
  if (!event || event.status === 'PROCESSED' || event.status === 'IGNORED' || !event.objectId)
    return;
  const provider = requireBilling(container);
  try {
    let companyId: string | null = null;
    if (event.type === 'checkout.session.completed') {
      const checkout = await provider.getCheckout(event.objectId);
      if (checkout?.subscriptionId) {
        if (checkout.companyId && checkout.customerId) {
          const owner = await resolveCompanyId({
            customerId: checkout.customerId,
            companyId: checkout.companyId,
          });
          if (owner) {
            await systemDb.company.updateMany({
              where: { id: owner, billingCustomerId: null },
              data: { billingCustomerId: checkout.customerId },
            });
          }
        }
        const subscription = await provider.getSubscription(checkout.subscriptionId);
        if (subscription) companyId = await syncSubscription(container, subscription);
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      const subscription = await provider.getSubscription(event.objectId);
      if (subscription) companyId = await syncSubscription(container, subscription);
    } else if (event.type.startsWith('invoice.')) {
      const invoice = await provider.getInvoice(event.objectId);
      if (invoice) companyId = await syncInvoice(container, invoice, event.type);
    }
    await systemDb.billingEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        attempts: event.attempts + 1,
        companyId,
        error: null,
      },
    });
  } catch (error) {
    const attempts = event.attempts + 1;
    await systemDb.billingEvent.update({
      where: { id: event.id },
      data: {
        attempts,
        error: (error instanceof Error ? error.message : 'Falha').slice(0, 300),
        ...(attempts >= JOB_RETRY_POLICY['billing.event'].attempts ? { status: 'FAILED' } : {}),
      },
    });
    throw error;
  }
}

/** Reprocessamento manual pela plataforma (evento falho). Seguro: o job relê o gateway. */
export async function replayBillingEvent(
  container: AppContainer,
  actor: Parameters<typeof auditPlatform>[0],
  billingEventId: string,
) {
  const event = await systemDb.billingEvent.findUnique({ where: { id: billingEventId } });
  if (!event) throw new NotFoundError('Evento não encontrado.');
  if (event.status !== 'FAILED' && event.status !== 'RECEIVED') {
    throw new ValidationError('Só eventos pendentes ou com falha podem ser reprocessados.');
  }
  await systemDb.billingEvent.update({
    where: { id: event.id },
    data: { status: 'RECEIVED', attempts: 0 },
  });
  await container.queue.enqueue(
    'billing.event',
    { billingEventId: event.id },
    { jobId: `billing-${event.id}-replay-${Date.now()}` },
  );
  await auditPlatform(actor, {
    companyId: event.companyId,
    action: 'billing.event_replayed',
    resourceType: 'BillingEvent',
    resourceId: event.id,
    metadata: { type: event.type },
  });
}
