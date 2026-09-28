import { AIProviderError } from '@botsaas/shared';
import { systemDb } from '@botsaas/database';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPricingCache } from '../src/modules/agent/pricing';
import {
  createCompanyFixture,
  createTestHarness,
  login,
  type TestHarness,
} from './helpers/harness';
import { countJobs, drainJobs } from './helpers/jobs';
import { createWhatsAppAccount, inboundText, postWebhook } from './helpers/whatsapp';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(async () => harness.close());
beforeEach(async () => {
  await harness.reset();
  clearPricingCache();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setupClinic(options: { bufferSeconds?: number } = {}) {
  const company = await createCompanyFixture(harness, {
    name: 'Clínica Bella',
    ownerEmail: 'dono@bella.com',
  });
  await createWhatsAppAccount(company.id, '555');
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: { enabled: true, messageBufferSeconds: options.bufferSeconds ?? 0 },
  });
  await systemDb.service.create({
    data: {
      companyId: company.id,
      name: 'Limpeza de pele',
      priceCents: 15000,
      durationMinutes: 60,
      description: 'Limpeza profunda',
    },
  });
  return company;
}

async function receive(text: string, from = '5511988887777') {
  await postWebhook(harness, inboundText('555', from, text));
  await drainJobs(harness, { only: ['webhook.process'] });
}

describe('fluxo do agente', () => {
  it('agrupa mensagens consecutivas (buffer) e chama a IA uma única vez', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T13:00:00Z'));
    await setupClinic({ bufferSeconds: 4 });

    for (const text of ['oi', 'queria saber', 'quanto custa', 'limpeza de pele?']) {
      await receive(text);
      vi.setSystemTime(new Date(Date.now() + 1000));
    }
    // Debounce: apenas UM job de resposta pendente para a conversa.
    expect(countJobs(harness, 'agent.reply')).toBe(1);

    // Cliente ainda "digitando" (última mensagem há 1s): o job se reagenda sem chamar a IA.
    await drainJobs(harness, { only: ['agent.reply'], maxRounds: 1 });
    expect(harness.ai.requests).toHaveLength(0);
    expect(countJobs(harness, 'agent.reply')).toBe(1);

    vi.setSystemTime(new Date(Date.now() + 5000));
    harness.ai.enqueue({ text: 'A limpeza de pele custa R$ 150,00 e dura 1 hora.' });
    await drainJobs(harness, { only: ['agent.reply'], maxRounds: 1 });

    expect(harness.ai.requests).toHaveLength(1);
    const lastUser = harness.ai.requests[0]?.messages.at(-1);
    expect(lastUser).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'oi\nqueria saber\nquanto custa\nlimpeza de pele?' }],
    });
    const handled = await systemDb.message.count({
      where: { direction: 'INBOUND', agentHandledAt: { not: null } },
    });
    expect(handled).toBe(4);
  });

  it('executa tool, responde pelo WhatsApp e registra execução e consumo', async () => {
    const company = await setupClinic();
    harness.ai.enqueue(
      { toolCalls: [{ name: 'search_services', input: { query: 'limpeza' } }] },
      { text: 'A limpeza de pele custa R$ 150,00.' },
    );
    await receive('quanto custa a limpeza de pele?');
    await drainJobs(harness, { only: ['agent.reply', 'message.send'] });

    // O resultado real da tool chegou ao modelo (com o preço cadastrado).
    const toolResultTurn = JSON.stringify(harness.ai.requests[1]?.messages.at(-1));
    expect(toolResultTurn).toContain('Limpeza de pele');
    expect(toolResultTurn).toContain('150,00');

    const reply = await systemDb.message.findFirstOrThrow({
      where: { companyId: company.id, sender: 'AI' },
    });
    expect(reply).toMatchObject({ status: 'SENT', text: 'A limpeza de pele custa R$ 150,00.' });
    expect(reply.externalId).toMatch(/^wamid\.mock\./);
    expect(harness.messaging.sent).toEqual([
      expect.objectContaining({ to: '5511988887777', kind: 'text' }),
    ]);

    const run = await systemDb.agentRun.findFirstOrThrow({ where: { companyId: company.id } });
    expect(run).toMatchObject({
      status: 'SUCCEEDED',
      iterations: 2,
      model: 'claude-opus-5',
      provider: 'mock',
    });
    expect(run.inputTokens).toBeGreaterThan(0);
    expect(run.toolCalls).toEqual([expect.objectContaining({ name: 'search_services', ok: true })]);
    expect(Number(run.estimatedCostUsd)).toBeGreaterThan(0);
    const usage = await systemDb.usageRecord.findFirstOrThrow({
      where: { companyId: company.id, kind: 'AI_CALL' },
    });
    expect(usage.agentRunId).toBe(run.id);
    expect(Number(usage.costUsd)).toBe(Number(run.estimatedCostUsd));

    // O prompt enviado contém a empresa e as regras, e o cliente como dado.
    const system = harness.ai.requests[0]?.system.map((block) => block.text).join('\n') ?? '';
    expect(system).toContain('Clínica Bella');
    expect(system).toContain('nunca faça diagnóstico');
    expect(harness.ai.requests[0]?.system[0]?.cacheBreakpoint).toBe(true);
  });

  it('handoff: a IA encaminha, a conversa vai para a fila humana e a IA para de responder', async () => {
    const company = await setupClinic();
    harness.ai.enqueue(
      {
        toolCalls: [
          { name: 'request_human_handoff', input: { reason: 'Cliente pediu atendente' } },
        ],
      },
      { text: 'Claro! Vou chamar alguém da equipe.' },
    );
    await receive('quero falar com um atendente');
    await drainJobs(harness, { only: ['agent.reply', 'message.send', 'domain-event.dispatch'] });

    const conversation = await systemDb.conversation.findFirstOrThrow({
      where: { companyId: company.id },
    });
    expect(conversation).toMatchObject({
      mode: 'HUMAN',
      status: 'WAITING_HUMAN',
      needsAttention: true,
    });
    const handoff = await systemDb.handoff.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(handoff).toMatchObject({
      requestedBy: 'AI',
      reason: 'Cliente pediu atendente',
      resolvedAt: null,
    });
    expect(
      await systemDb.notification.count({
        where: { companyId: company.id, type: 'HANDOFF_REQUESTED' },
      }),
    ).toBe(1);

    // Nova mensagem do cliente: a IA NÃO responde em modo humano.
    await receive('alô?');
    expect(countJobs(harness, 'agent.reply')).toBe(0);
    expect(harness.ai.requests).toHaveLength(2);
  });

  it('atendente assume, responde e devolve para a IA com resumo', async () => {
    const company = await setupClinic();
    harness.ai.enqueue({ text: 'Olá! Como posso ajudar?' });
    await receive('oi');
    await drainJobs(harness, { only: ['agent.reply', 'message.send'] });
    const conversation = await systemDb.conversation.findFirstOrThrow({
      where: { companyId: company.id },
    });

    const owner = await login(harness.app, 'dono@bella.com');
    const takeOver = await owner.post(`/api/app/conversations/${conversation.id}/mode`, {
      action: 'take_over',
    });
    expect(takeOver.statusCode).toBe(200);
    expect(takeOver.json()).toMatchObject({
      mode: 'HUMAN',
      assignee: { name: expect.any(String) },
    });

    const reply = await owner.post(`/api/app/conversations/${conversation.id}/messages`, {
      text: 'Oi! Aqui é a Ana, da recepção.',
    });
    expect(reply.statusCode).toBe(201);
    await drainJobs(harness, { only: ['message.send'] });
    expect(harness.messaging.sent.at(-1)).toMatchObject({
      body: expect.objectContaining({ text: 'Oi! Aqui é a Ana, da recepção.' }),
    });

    await receive('obrigado, Ana! vou pensar');
    expect(countJobs(harness, 'agent.reply')).toBe(0);

    harness.ai.enqueue({
      text: 'Cliente foi atendido pela Ana e vai pensar sobre a limpeza de pele.',
    });
    const back = await owner.post(`/api/app/conversations/${conversation.id}/mode`, {
      action: 'return_to_ai',
    });
    expect(back.json()).toMatchObject({ mode: 'AI', status: 'OPEN' });
    // Mensagens vistas pela equipe não serão respondidas de novo pela IA.
    expect(
      await systemDb.message.count({
        where: { conversationId: conversation.id, direction: 'INBOUND', agentHandledAt: null },
      }),
    ).toBe(0);

    await drainJobs(harness, { only: ['conversation.summarize'] });
    const handoff = await systemDb.handoff.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(handoff.resolvedAt).not.toBeNull();
    expect(handoff.resolutionSummary).toContain('Ana');
    const summary = await systemDb.conversationSummary.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(summary.summary).toContain('Ana');

    // A próxima resposta da IA recebe o contexto do atendimento humano.
    harness.ai.enqueue({ text: 'Que bom! Posso ajudar em algo mais?' });
    await receive('voltei, quero agendar');
    await drainJobs(harness, { only: ['agent.reply'] });
    const system =
      harness.ai.requests
        .at(-1)
        ?.system.map((block) => block.text)
        .join('\n') ?? '';
    expect(system).toContain('Um atendente humano atendeu este cliente recentemente');
  });

  it('falha definitiva da IA: não inventa resposta, marca a conversa e encaminha para humano', async () => {
    const company = await setupClinic();
    harness.ai.enqueue({
      error: new AIProviderError('Anthropic indisponível', { retryable: false }),
    });
    await receive('oi, tudo bem?');
    await drainJobs(harness, { only: ['agent.reply', 'message.send'] });

    expect(await systemDb.message.count({ where: { companyId: company.id, sender: 'AI' } })).toBe(
      0,
    );
    const conversation = await systemDb.conversation.findFirstOrThrow({
      where: { companyId: company.id },
    });
    expect(conversation).toMatchObject({
      mode: 'HUMAN',
      status: 'WAITING_HUMAN',
      aiFailureCount: 1,
    });
    expect(await systemDb.agentRun.count({ where: { status: 'FAILED' } })).toBe(1);
    expect(await systemDb.notification.count({ where: { type: 'AGENT_FAILED' } })).toBe(1);
    expect(await systemDb.errorLog.count({ where: { companyId: company.id, source: 'AI' } })).toBe(
      1,
    );
  });

  it('recusa do classificador: registra a categoria na execução, sem resposta da IA', async () => {
    const company = await setupClinic();
    harness.ai.enqueue({ refusal: true, category: 'cyber' });
    await receive('oi, tudo bem?');
    await drainJobs(harness, { only: ['agent.reply', 'message.send'] });

    const run = await systemDb.agentRun.findFirstOrThrow({ where: { companyId: company.id } });
    expect(run).toMatchObject({ status: 'FAILED', errorCode: 'refused', stopReason: 'refusal' });
    expect(run.errorMessage).toBe('Recusa do provedor de IA (categoria: cyber).');
    expect(await systemDb.message.count({ where: { companyId: company.id, sender: 'AI' } })).toBe(
      0,
    );
  });

  it('falha temporária da IA: a mensagem não se perde e o job é repetido', async () => {
    await setupClinic();
    harness.ai.enqueue({ error: new AIProviderError('overloaded', { retryable: true }) });
    await receive('oi');
    const job = harness.queue.take('agent.reply')[0];
    expect(job).toBeDefined();
    const { runJob } = await import('../src/jobs/processors');
    await expect(
      runJob(harness.container, 'agent.reply', job!.payload, { attemptsMade: 0, maxAttempts: 3 }),
    ).rejects.toThrow('overloaded');
    expect(
      await systemDb.message.count({ where: { direction: 'INBOUND', agentHandledAt: null } }),
    ).toBe(1);

    harness.ai.enqueue({ text: 'Olá! Tudo bem por aqui.' });
    await runJob(harness.container, 'agent.reply', job!.payload, {
      attemptsMade: 1,
      maxAttempts: 3,
    });
    expect(await systemDb.message.count({ where: { sender: 'AI' } })).toBe(1);
  });

  it('limite de uso atingido: a IA não é chamada e o atendimento vai para humano (sem corte abrupto)', async () => {
    const company = await setupClinic();
    await systemDb.usageLimit.create({
      data: { companyId: company.id, metric: 'AI_CALLS_PER_MONTH', limitValue: 0 },
    });
    await receive('oi');
    await drainJobs(harness, { only: ['agent.reply'] });
    expect(harness.ai.requests).toHaveLength(0);
    const conversation = await systemDb.conversation.findFirstOrThrow({
      where: { companyId: company.id },
    });
    expect(conversation.mode).toBe('HUMAN');
    expect(await systemDb.notification.count({ where: { type: 'USAGE_LIMIT_REACHED' } })).toBe(1);

    const owner = await login(harness.app, 'dono@bella.com');
    const status = (await owner.get('/api/app/company/usage-status')).json();
    expect(status.state).toBe('LIMIT_REACHED');
  });

  it('IA desativada na empresa (emergência): nada é respondido automaticamente', async () => {
    await setupClinic();
    const owner = await login(harness.app, 'dono@bella.com');
    expect((await owner.post('/api/app/ai/emergency-stop')).statusCode).toBe(200);
    await receive('oi');
    await drainJobs(harness, { only: ['agent.reply'] });
    expect(harness.ai.requests).toHaveLength(0);
    expect(await systemDb.auditLog.count({ where: { action: 'ai.emergency_stop' } })).toBe(1);
  });

  it('janela de 24h fechada: mensagem livre é bloqueada e template é exigido', async () => {
    const company = await setupClinic();
    await receive('oi');
    const conversation = await systemDb.conversation.findFirstOrThrow({
      where: { companyId: company.id },
    });
    await systemDb.conversation.update({
      where: { id: conversation.id },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const owner = await login(harness.app, 'dono@bella.com');
    const response = await owner.post(`/api/app/conversations/${conversation.id}/messages`, {
      text: 'Olá, tudo bem?',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details).toEqual({ requiresTemplate: true });
    const detail = (await owner.get(`/api/app/conversations/${conversation.id}`)).json();
    expect(detail.window).toMatchObject({ isOpen: false, requiresTemplate: true });

    await owner.post(
      `/api/app/integrations/whatsapp/accounts/${(await systemDb.whatsAppAccount.findFirstOrThrow()).id}/templates/sync`,
    );
    const template = await owner.post(`/api/app/conversations/${conversation.id}/template`, {
      templateName: 'retomar_atendimento',
      languageCode: 'pt_BR',
      bodyParameters: ['João'],
    });
    expect(template.statusCode).toBe(201);
    expect(template.json().text).toBe('Olá João! Podemos continuar seu atendimento?');
  });

  it('isolamento: a IA de uma empresa nunca recupera conhecimento de outra', async () => {
    const company = await setupClinic();
    const other = await createCompanyFixture(harness, {
      name: 'Outra Clínica',
      ownerEmail: 'outra@x.com',
    });
    await systemDb.knowledgeEntry.create({
      data: {
        companyId: other.id,
        type: 'FAQ',
        title: 'Estacionamento',
        content: 'Temos estacionamento gratuito com manobrista.',
      },
    });
    await systemDb.knowledgeEntry.create({
      data: {
        companyId: company.id,
        type: 'FAQ',
        title: 'Formas de pagamento',
        content: 'Aceitamos Pix e cartão.',
      },
    });
    harness.ai.enqueue(
      { toolCalls: [{ name: 'search_knowledge', input: { query: 'estacionamento manobrista' } }] },
      { text: 'Não tenho essa informação.' },
    );
    await receive('vocês têm estacionamento com manobrista?');
    await drainJobs(harness, { only: ['agent.reply'] });
    const everything = JSON.stringify(harness.ai.requests);
    expect(everything).not.toContain('manobrista.');
    expect(everything).not.toContain('estacionamento gratuito');

    const owner = await login(harness.app, 'dono@bella.com');
    const search = (await owner.get('/api/app/knowledge/search?q=pagamento pix')).json();
    expect(search.map((hit: { title: string }) => hit.title)).toEqual(['Formas de pagamento']);
    expect((await owner.get('/api/app/knowledge/search?q=estacionamento')).json()).toEqual([]);
  });
});
