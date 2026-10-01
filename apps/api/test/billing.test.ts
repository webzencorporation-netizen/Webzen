import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { checkAiAllowance } from '../src/modules/usage/limits';
import {
  addMember,
  createCompanyFixture,
  createTestHarness,
  createUser,
  login,
  type TestClient,
  type TestHarness,
} from './helpers/harness';
import { drainJobs } from './helpers/jobs';

/**
 * Cobrança ponta a ponta com o gateway simulado: o mesmo caminho da Stripe (checkout com
 * preço verificado → webhook assinado → fila → releitura do objeto no gateway → banco).
 */
let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());

const PRICES = {
  STARTER: { MONTHLY: 'price_starter_m', YEARLY: 'price_starter_y' },
  PRO: { MONTHLY: 'price_pro_m', YEARLY: 'price_pro_y' },
  BUSINESS: { MONTHLY: 'price_business_m', YEARLY: 'price_business_y' },
} as const;

beforeEach(async () => {
  await harness.reset();
  for (const [key, ids] of Object.entries(PRICES)) {
    const plan = await systemDb.plan.update({
      where: { key },
      data: { stripePriceMonthlyId: ids.MONTHLY, stripePriceYearlyId: ids.YEARLY },
    });
    harness.billing.definePrice(ids.MONTHLY, plan.priceMonthlyCents, 'MONTHLY');
    harness.billing.definePrice(ids.YEARLY, plan.priceYearlyCents ?? 0, 'YEARLY');
  }
});

async function newCustomer(name = 'Clínica Sol', ownerEmail = 'dona@sol.test') {
  const company = await createCompanyFixture(harness, { name, ownerEmail, planKey: 'STARTER' });
  // Como no cadastro público: assinatura aguardando pagamento.
  await systemDb.subscription.update({
    where: { companyId: company.id },
    data: { status: 'INCOMPLETE' },
  });
  return { company, owner: await login(harness.app, ownerEmail) };
}

async function deliver(
  events: { type: string; objectId: string; id?: string; livemode?: boolean }[],
) {
  const outcomes: string[] = [];
  for (const event of events) {
    const { body, signature } = harness.billing.signEvent(event);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    outcomes.push(response.json().outcome);
  }
  await drainJobs(harness, { only: ['billing.event', 'email.send'] });
  return outcomes;
}

async function subscribe(owner: TestClient, planKey = 'PRO', interval = 'YEARLY') {
  const checkout = await owner.post('/api/app/billing/checkout', { planKey, interval });
  expect(checkout.statusCode).toBe(200);
  const checkoutId = (checkout.json().url as string).split('/').pop()!;
  return deliver(harness.billing.completeCheckout(checkoutId));
}

describe('contratação do plano', () => {
  it('checkout → webhook → plano ativo, fatura paga, e-mail e IA liberada', async () => {
    const { company, owner } = await newCustomer();
    expect((await checkAiAllowance(systemScope(harness.container, company.id))).allowed).toBe(
      false,
    );

    // Um preço vindo do navegador é ignorado: só plano + período chegam ao servidor.
    const checkout = await owner.post('/api/app/billing/checkout', {
      planKey: 'PRO',
      interval: 'YEARLY',
      priceCents: 1,
    });
    expect(checkout.statusCode).toBe(200);
    expect(harness.billing.calls).toContain('createCheckout:price_pro_y');
    const customerId = (await systemDb.company.findUniqueOrThrow({ where: { id: company.id } }))
      .billingCustomerId;
    expect(customerId).toMatch(/^cus_/);

    const checkoutId = (checkout.json().url as string).split('/').pop()!;
    expect(await deliver(harness.billing.completeCheckout(checkoutId))).toEqual([
      'queued',
      'queued',
      'queued',
    ]);

    const subscription = await systemDb.subscription.findUniqueOrThrow({
      where: { companyId: company.id },
      include: { plan: true },
    });
    expect(subscription).toMatchObject({ status: 'ACTIVE', interval: 'YEARLY' });
    expect(subscription.plan.key).toBe('PRO');
    expect(subscription.externalId).toMatch(/^sub_/);

    const invoices = (await owner.get('/api/app/billing/invoices')).json();
    expect(invoices.total).toBe(1);
    expect(invoices.items[0]).toMatchObject({
      status: 'PAID',
      amountPaidCents: 450_000,
      planKey: 'PRO',
      interval: 'YEARLY',
    });
    expect(harness.email.sent.map((email) => email.subject)).toContain(
      'Pagamento confirmado — WebZen',
    );
    expect((await checkAiAllowance(systemScope(harness.container, company.id))).allowed).toBe(true);

    const overview = (await owner.get('/api/app/billing')).json();
    expect(overview).toMatchObject({
      billingEnabled: true,
      managedBy: 'gateway',
      subscription: { status: 'ACTIVE', priceCents: 450_000, plan: { key: 'PRO' } },
      paymentMethod: { last4: '4242' },
    });
  });

  it('evento repetido não duplica fatura nem e-mail', async () => {
    const { company, owner } = await newCustomer();
    await subscribe(owner);
    const invoice = await systemDb.invoice.findFirstOrThrow({ where: { companyId: company.id } });
    const emails = harness.email.sent.length;
    const event = await systemDb.billingEvent.findFirstOrThrow({ where: { type: 'invoice.paid' } });

    expect(
      await deliver([{ id: event.externalId, type: 'invoice.paid', objectId: invoice.externalId }]),
    ).toEqual(['duplicate']);
    expect(await systemDb.invoice.count({ where: { companyId: company.id } })).toBe(1);
    expect(harness.email.sent.length).toBe(emails);
  });

  it('webhook com assinatura inválida é recusado e não grava nada', async () => {
    const { body } = harness.billing.signEvent({ type: 'invoice.paid', objectId: 'in_x' });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-mock-signature': 'ab'.repeat(32) },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(await systemDb.billingEvent.count()).toBe(0);
  });

  it('evento de produção num ambiente de teste é ignorado', async () => {
    const { owner } = await newCustomer();
    await subscribe(owner);
    const invoice = await systemDb.invoice.findFirstOrThrow();
    expect(
      await deliver([
        { type: 'invoice.payment_failed', objectId: invoice.externalId, livemode: true },
      ]),
    ).toEqual(['ignored']);
    const event = await systemDb.billingEvent.findFirstOrThrow({ where: { livemode: true } });
    expect(event.status).toBe('IGNORED');
    expect(harness.email.sent.map((email) => email.subject)).not.toContain(
      'Não conseguimos cobrar sua assinatura do WebZen',
    );
  });

  it('preço do gateway diferente do plano bloqueia a cobrança', async () => {
    const { owner } = await newCustomer();
    harness.billing.definePrice('price_pro_m', 100, 'MONTHLY');
    const response = await owner.post('/api/app/billing/checkout', {
      planKey: 'PRO',
      interval: 'MONTHLY',
    });
    expect(response.statusCode).toBe(502);
    expect(harness.billing.calls.some((call) => call.startsWith('createCheckout'))).toBe(false);
  });

  it('só o proprietário contrata; o administrador vê; o atendente não vê', async () => {
    const { company } = await newCustomer();
    await addMember(company.id, 'admin@sol.test', 'COMPANY_ADMIN');
    await addMember(company.id, 'atendente@sol.test', 'ATTENDANT');
    const admin = await login(harness.app, 'admin@sol.test');
    const attendant = await login(harness.app, 'atendente@sol.test');
    expect((await admin.get('/api/app/billing')).statusCode).toBe(200);
    expect(
      (await admin.post('/api/app/billing/checkout', { planKey: 'PRO', interval: 'MONTHLY' }))
        .statusCode,
    ).toBe(403);
    expect((await attendant.get('/api/app/billing')).statusCode).toBe(403);
  });

  it('faturas de uma empresa não aparecem para outra', async () => {
    const { owner } = await newCustomer();
    await subscribe(owner);
    const other = await newCustomer('Pet Lua', 'dono@lua.test');
    expect((await other.owner.get('/api/app/billing/invoices')).json().total).toBe(0);
  });
});

describe('assinatura ativa', () => {
  it('troca de plano usa o preço oficial do novo plano e atualiza na hora', async () => {
    const { company, owner } = await newCustomer();
    await subscribe(owner, 'PRO', 'YEARLY');
    const response = await owner.post('/api/app/billing/change-plan', {
      planKey: 'BUSINESS',
      interval: 'MONTHLY',
    });
    expect(response.statusCode).toBe(200);
    expect(harness.billing.calls).toContain('changePrice:price_business_m');
    expect(response.json().subscription).toMatchObject({
      interval: 'MONTHLY',
      plan: { key: 'BUSINESS' },
    });
    const audit = await systemDb.auditLog.findFirst({
      where: { companyId: company.id, action: 'subscription.plan_changed' },
    });
    expect(audit).not.toBeNull();
  });

  it('downgrade que não comporta o uso atual é bloqueado com explicação', async () => {
    const { company, owner } = await newCustomer();
    await subscribe(owner, 'PRO', 'MONTHLY');
    for (const email of ['a@sol.test', 'b@sol.test', 'c@sol.test'])
      await addMember(company.id, email, 'VIEWER');
    const response = await owner.post('/api/app/billing/change-plan', {
      planKey: 'STARTER',
      interval: 'MONTHLY',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Usuários (4 de 3)');
    expect(harness.billing.calls.some((call) => call.startsWith('changePrice'))).toBe(false);
  });

  it('cancelar agenda o fim, avisa por e-mail e pode ser desfeito', async () => {
    const { company, owner } = await newCustomer();
    await subscribe(owner);
    const cancelled = await owner.post('/api/app/billing/cancel');
    expect(cancelled.json().subscription.cancelAtPeriodEnd).toBe(true);
    await drainJobs(harness, { only: ['email.send'] });
    expect(harness.email.sent.map((email) => email.subject)).toContain(
      'Assinatura cancelada — WebZen',
    );
    expect((await owner.post('/api/app/billing/cancel')).statusCode).toBe(400);
    // Até o fim do período o serviço continua.
    expect((await checkAiAllowance(systemScope(harness.container, company.id))).allowed).toBe(true);

    const reactivated = await owner.post('/api/app/billing/reactivate');
    expect(reactivated.json().subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('falha de pagamento avisa o dono; assinatura encerrada bloqueia a IA', async () => {
    const { company, owner } = await newCustomer();
    await subscribe(owner);
    const subscription = await systemDb.subscription.findUniqueOrThrow({
      where: { companyId: company.id },
    });
    const invoiceId = harness.billing.addInvoice(subscription.externalId!, 450_000, 'OPEN');
    await deliver([{ type: 'invoice.payment_failed', objectId: invoiceId }]);
    const alert = await systemDb.notification.findFirst({
      where: { companyId: company.id, title: 'Pagamento recusado' },
    });
    expect(alert?.severity).toBe('CRITICAL');
    expect(harness.email.sent.map((email) => email.subject)).toContain(
      'Não conseguimos cobrar sua assinatura do WebZen',
    );

    harness.billing.subscriptions.get(subscription.externalId!)!.status = 'CANCELLED';
    await deliver([{ type: 'customer.subscription.deleted', objectId: subscription.externalId! }]);
    expect((await checkAiAllowance(systemScope(harness.container, company.id))).allowed).toBe(
      false,
    );
  });
});

describe('plataforma', () => {
  it('evento que falhou pode ser reprocessado pelo administrador', async () => {
    const { company, owner } = await newCustomer();
    await subscribe(owner);
    const subscription = await systemDb.subscription.findUniqueOrThrow({
      where: { companyId: company.id },
    });
    const original = harness.billing.getSubscription.bind(harness.billing);
    harness.billing.getSubscription = async () => {
      throw new Error('gateway fora do ar');
    };
    const { body, signature } = harness.billing.signEvent({
      type: 'customer.subscription.updated',
      objectId: subscription.externalId!,
    });
    await harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      payload: body,
    });
    const event = await systemDb.billingEvent.findFirstOrThrow({
      where: { type: 'customer.subscription.updated' },
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await drainJobs(harness, { only: ['billing.event'] }).catch(() => undefined);
      await harness.container.queue.enqueue('billing.event', { billingEventId: event.id });
    }
    expect(
      (await systemDb.billingEvent.findUniqueOrThrow({ where: { id: event.id } })).status,
    ).toBe('FAILED');

    harness.billing.getSubscription = original;
    harness.queue.clear();
    await createUser({ email: 'root@webzen.test', platformRole: 'PLATFORM_OWNER' });
    const admin = await login(harness.app, 'root@webzen.test');
    const failed = (await admin.get('/api/platform/billing/events?status=FAILED')).json();
    expect(failed.total).toBe(1);
    expect((await admin.post(`/api/platform/billing/events/${event.id}/replay`)).statusCode).toBe(
      200,
    );
    await drainJobs(harness, { only: ['billing.event'] });
    expect(
      (await systemDb.billingEvent.findUniqueOrThrow({ where: { id: event.id } })).status,
    ).toBe('PROCESSED');

    expect((await owner.get('/api/platform/billing/events')).statusCode).toBe(403);
  });
});
