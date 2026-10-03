import { systemDb } from '@botsaas/database';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { systemScope } from '../src/lib/scope';
import { checkAiAllowance } from '../src/modules/usage/limits';
import {
  addMember,
  createCompanyFixture,
  createTestHarness,
  createUser,
  login,
  type TestHarness,
} from './helpers/harness';
import { drainJobs } from './helpers/jobs';

/**
 * Fluxos de conta self-service: cadastro, confirmação de e-mail, recuperação de senha,
 * convites de equipe e sessões. Nenhuma resposta pode revelar se um e-mail tem cadastro.
 */
let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());
afterEach(() => {
  harness.container.env.BILLING_TRIAL_DAYS = 0;
});

const post = (url: string, payload: unknown, cookie?: string) =>
  harness.app.inject({
    method: 'POST',
    url,
    headers: { 'x-requested-with': 'test', ...(cookie ? { cookie } : {}) },
    payload: payload as object,
  });

const cookieOf = (response: LightMyRequestResponse) => {
  const raw = response.headers['set-cookie'];
  return (Array.isArray(raw) ? raw[0] : raw)?.split(';')[0] ?? '';
};

/** Processa a fila de e-mails e devolve o token do último link enviado para o endereço. */
async function lastLinkToken(email: string): Promise<string> {
  await drainJobs(harness, { only: ['email.send'] });
  const message = [...harness.email.sent].reverse().find((item) => item.to === email);
  const token = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`nenhum link enviado para ${email}`);
  return decodeURIComponent(token);
}

const signupBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Marina Costa',
  email: 'marina@padaria.test',
  password: 'senha-forte-123',
  companyName: 'Padaria Costa',
  templateKey: 'RESTAURANT',
  planKey: 'PRO',
  interval: 'YEARLY',
  acceptTerms: true,
  ...overrides,
});

describe('cadastro self-service', () => {
  it('cria conta, empresa e assinatura pendente; só entra depois de confirmar o e-mail', async () => {
    const response = await post('/api/auth/signup', signupBody());
    expect(response.statusCode).toBe(202);
    expect(response.headers['set-cookie']).toBeUndefined();

    const user = await systemDb.user.findUniqueOrThrow({ where: { email: 'marina@padaria.test' } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toContain('senha-forte-123');
    const membership = await systemDb.companyMember.findFirstOrThrow({
      where: { userId: user.id },
      include: { company: { include: { subscription: { include: { plan: true } } } } },
    });
    expect(membership.role).toBe('COMPANY_OWNER');
    expect(membership.company.status).toBe('ONBOARDING');
    expect(membership.company.subscription).toMatchObject({
      status: 'INCOMPLETE',
      interval: 'YEARLY',
    });
    expect(membership.company.subscription?.plan.key).toBe('PRO');

    const blocked = await post('/api/auth/login', {
      email: 'marina@padaria.test',
      password: 'senha-forte-123',
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.details.reason).toBe('EMAIL_NOT_VERIFIED');

    const token = await lastLinkToken('marina@padaria.test');
    const verified = await post('/api/auth/verify-email', { token });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().activeCompany.name).toBe('Padaria Costa');
    const me = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieOf(verified) },
    });
    expect(me.statusCode).toBe(200);
    await drainJobs(harness, { only: ['email.send'] });
    expect(harness.email.sent.map((item) => item.subject)).toContain('Boas-vindas ao WebZen');

    // Sem pagamento, a IA continua bloqueada.
    expect(
      (await checkAiAllowance(systemScope(harness.container, membership.companyId))).allowed,
    ).toBe(false);

    expect((await post('/api/auth/verify-email', { token })).statusCode).toBe(400);
    expect(
      (await post('/api/auth/login', { email: 'marina@padaria.test', password: 'senha-forte-123' }))
        .statusCode,
    ).toBe(200);
  });

  it('e-mail já cadastrado recebe a mesma resposta e nada é criado', async () => {
    await createUser({ email: 'ja@existe.test', name: 'Já Existe' });
    const companies = await systemDb.company.count();

    const response = await post('/api/auth/signup', signupBody({ email: 'ja@existe.test' }));
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe(
      (await post('/api/auth/signup', signupBody({ email: 'novo@novo.test' }))).body,
    );
    expect(await systemDb.company.count()).toBe(companies + 1);

    await drainJobs(harness, { only: ['email.send'] });
    const warning = harness.email.sent.find((item) => item.to === 'ja@existe.test');
    expect(warning?.subject).toBe('Você já tem uma conta no WebZen');
  });

  it('valida plano, termos e senha no servidor', async () => {
    expect(
      (await post('/api/auth/signup', signupBody({ planKey: 'INEXISTENTE' }))).statusCode,
    ).toBe(404);
    expect((await post('/api/auth/signup', signupBody({ acceptTerms: false }))).statusCode).toBe(
      400,
    );
    expect((await post('/api/auth/signup', signupBody({ password: 'curta' }))).statusCode).toBe(
      400,
    );
    await systemDb.plan.update({ where: { key: 'BUSINESS' }, data: { isPublic: false } });
    expect((await post('/api/auth/signup', signupBody({ planKey: 'BUSINESS' }))).statusCode).toBe(
      404,
    );
  });

  it('teste grátis configurado começa na confirmação do e-mail, uma vez por pessoa', async () => {
    harness.container.env.BILLING_TRIAL_DAYS = 7;
    await post('/api/auth/signup', signupBody());
    await post('/api/auth/verify-email', { token: await lastLinkToken('marina@padaria.test') });
    const user = await systemDb.user.findUniqueOrThrow({ where: { email: 'marina@padaria.test' } });
    const subscription = await systemDb.subscription.findFirstOrThrow({
      where: { company: { members: { some: { userId: user.id } } } },
    });
    expect(subscription.status).toBe('TRIALING');
    expect(subscription.trialEndsAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(user.trialUsedAt).not.toBeNull();
    expect(
      (await checkAiAllowance(systemScope(harness.container, subscription.companyId))).allowed,
    ).toBe(true);
  });
});

describe('recuperação de senha', () => {
  it('e-mail desconhecido recebe a mesma resposta e nenhum e-mail', async () => {
    const response = await post('/api/auth/forgot-password', { email: 'ninguem@nada.test' });
    expect(response.statusCode).toBe(202);
    await drainJobs(harness, { only: ['email.send'] });
    expect(harness.email.sent).toEqual([]);
  });

  it('redefine a senha, derruba todas as sessões e o link vale uma vez', async () => {
    await createUser({ email: 'ana@loja.test', name: 'Ana' });
    const session = await login(harness.app, 'ana@loja.test');
    expect((await post('/api/auth/forgot-password', { email: 'ANA@loja.test ' })).statusCode).toBe(
      202,
    );
    const token = await lastLinkToken('ana@loja.test');

    expect(
      (await post('/api/auth/reset-password', { token, password: 'nova-senha-456' })).statusCode,
    ).toBe(200);
    expect((await session.get('/api/auth/me')).statusCode).toBe(401);
    expect(
      (await post('/api/auth/reset-password', { token, password: 'outra-senha-789' })).statusCode,
    ).toBe(400);
    await login(harness.app, 'ana@loja.test', 'nova-senha-456');
    await drainJobs(harness, { only: ['email.send'] });
    expect(harness.email.sent.at(-1)?.subject).toBe('Sua senha do WebZen foi alterada');
  });

  it('link expirado ou antigo não funciona', async () => {
    await createUser({ email: 'bia@loja.test' });
    await post('/api/auth/forgot-password', { email: 'bia@loja.test' });
    const first = await lastLinkToken('bia@loja.test');
    await post('/api/auth/forgot-password', { email: 'bia@loja.test' });
    const second = await lastLinkToken('bia@loja.test');
    expect(
      (await post('/api/auth/reset-password', { token: first, password: 'nova-senha-456' }))
        .statusCode,
    ).toBe(400);

    await systemDb.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(
      (await post('/api/auth/reset-password', { token: second, password: 'nova-senha-456' }))
        .statusCode,
    ).toBe(400);
  });

  it('limita pedidos por endereço de destino', async () => {
    await createUser({ email: 'alvo@caixa.test' });
    const codes: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      codes.push(
        (await post('/api/auth/forgot-password', { email: 'alvo@caixa.test' })).statusCode,
      );
    }
    expect(codes.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(codes[5]).toBe(429);
  });

  it('token de redefinição não confirma e-mail que mudou depois da emissão', async () => {
    const user = await createUser({ email: 'velho@caixa.test' });
    await post('/api/auth/forgot-password', { email: 'velho@caixa.test' });
    const token = await lastLinkToken('velho@caixa.test');
    await systemDb.user.update({ where: { id: user.id }, data: { email: 'novo@caixa.test' } });
    expect(
      (await post('/api/auth/reset-password', { token, password: 'nova-senha-456' })).statusCode,
    ).toBe(400);
  });
});

describe('convites de equipe', () => {
  async function setup() {
    const company = await createCompanyFixture(harness, {
      name: 'Salão Bela',
      ownerEmail: 'dono@bela.test',
    });
    const owner = await login(harness.app, 'dono@bela.test');
    return { company, owner };
  }

  it('convida por e-mail; quem não tem conta cria e entra na empresa certa com o papel do convite', async () => {
    const { company, owner } = await setup();
    const created = await owner.post('/api/app/team/invitations', {
      email: 'Julia@Bela.test',
      role: 'ATTENDANT',
    });
    expect(created.statusCode).toBe(201);
    const token = await lastLinkToken('julia@bela.test');

    const preview = await post('/api/auth/invitations/preview', { token });
    expect(preview.json()).toMatchObject({
      companyName: 'Salão Bela',
      role: 'ATTENDANT',
      hasAccount: false,
    });

    // O corpo não escolhe empresa nem papel, mesmo que tente.
    const accepted = await post('/api/auth/invitations/accept', {
      token,
      name: 'Júlia',
      password: 'senha-da-julia-1',
      companyId: '00000000-0000-0000-0000-000000000000',
      role: 'COMPANY_OWNER',
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().activeCompany).toMatchObject({ id: company.id, role: 'ATTENDANT' });
    const user = await systemDb.user.findUniqueOrThrow({ where: { email: 'julia@bela.test' } });
    expect(user.emailVerifiedAt).not.toBeNull();

    expect(
      (
        await post('/api/auth/invitations/accept', {
          token,
          name: 'Outra',
          password: 'senha-outra-123',
        })
      ).statusCode,
    ).toBe(400);
    expect((await owner.get('/api/app/team/invitations')).json()).toEqual([]);
  });

  it('e-mail com conta só aceita logado nessa conta', async () => {
    const { company, owner } = await setup();
    await createUser({ email: 'leo@outra.test', name: 'Leo' });
    await createUser({ email: 'intruso@x.test' });
    await owner.post('/api/app/team/invitations', { email: 'leo@outra.test', role: 'MANAGER' });
    const token = await lastLinkToken('leo@outra.test');

    expect((await post('/api/auth/invitations/accept', { token })).statusCode).toBe(401);
    const intruder = await login(harness.app, 'intruso@x.test');
    expect(
      (await post('/api/auth/invitations/accept', { token }, intruder.cookie)).statusCode,
    ).toBe(401);

    const leo = await login(harness.app, 'leo@outra.test');
    const accepted = await post('/api/auth/invitations/accept', { token }, leo.cookie);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().activeCompany).toMatchObject({ id: company.id, role: 'MANAGER' });
  });

  it('respeita papéis, revogação e isolamento entre empresas', async () => {
    const { company, owner } = await setup();
    await addMember(company.id, 'atendente@bela.test', 'ATTENDANT');
    const attendant = await login(harness.app, 'atendente@bela.test');
    expect(
      (await attendant.post('/api/app/team/invitations', { email: 'x@x.test', role: 'VIEWER' }))
        .statusCode,
    ).toBe(403);

    const invite = await owner.post('/api/app/team/invitations', {
      email: 'rev@bela.test',
      role: 'VIEWER',
    });
    const token = await lastLinkToken('rev@bela.test');

    await createCompanyFixture(harness, { name: 'Outra', ownerEmail: 'dono@outra.test' });
    const other = await login(harness.app, 'dono@outra.test');
    expect((await other.delete(`/api/app/team/invitations/${invite.json().id}`)).statusCode).toBe(
      404,
    );

    expect((await owner.delete(`/api/app/team/invitations/${invite.json().id}`)).statusCode).toBe(
      200,
    );
    expect(
      (
        await post('/api/auth/invitations/accept', {
          token,
          name: 'Rev',
          password: 'senha-rev-1234',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('convites pendentes contam no limite de usuários do plano', async () => {
    const { company, owner } = await setup();
    await systemDb.usageLimit.create({
      data: { companyId: company.id, metric: 'USERS', limitValue: 2 },
    });
    expect(
      (await owner.post('/api/app/team/invitations', { email: 'a@bela.test', role: 'VIEWER' }))
        .statusCode,
    ).toBe(201);
    const blocked = await owner.post('/api/app/team/invitations', {
      email: 'b@bela.test',
      role: 'VIEWER',
    });
    expect(blocked.statusCode).toBe(402);
  });
});

describe('sessões', () => {
  it('lista as próprias sessões e encerra as outras', async () => {
    await createUser({ email: 'caio@x.test' });
    const laptop = await login(harness.app, 'caio@x.test');
    const phone = await login(harness.app, 'caio@x.test');
    const list = (await laptop.get('/api/auth/sessions')).json<
      { id: string; current: boolean }[]
    >();
    expect(list).toHaveLength(2);
    expect(list.filter((session) => session.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('tokenHash');

    expect((await laptop.post('/api/auth/sessions/revoke-others')).statusCode).toBe(200);
    expect((await phone.get('/api/auth/me')).statusCode).toBe(401);
    expect((await laptop.get('/api/auth/me')).statusCode).toBe(200);
  });

  it('não encerra sessão de outra pessoa', async () => {
    await createUser({ email: 'u1@x.test' });
    await createUser({ email: 'u2@x.test' });
    const first = await login(harness.app, 'u1@x.test');
    const second = await login(harness.app, 'u2@x.test');
    const [secondSession] = (await second.get('/api/auth/sessions')).json<{ id: string }[]>();
    expect((await first.delete(`/api/auth/sessions/${secondSession!.id}`)).statusCode).toBe(404);
    expect((await second.get('/api/auth/me')).statusCode).toBe(200);
  });

  it('sessão parada além do limite de inatividade expira', async () => {
    const user = await createUser({ email: 'parado@x.test' });
    const session = await login(harness.app, 'parado@x.test');
    const idleHours = harness.container.env.SESSION_IDLE_TIMEOUT_HOURS;
    await systemDb.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - (idleHours + 1) * 3600_000) },
    });
    expect((await session.get('/api/auth/me')).statusCode).toBe(401);
  });
});
