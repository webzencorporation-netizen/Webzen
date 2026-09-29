import { systemDb } from '@botsaas/database';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverStalledReplies } from '../src/modules/agent/recovery';
import { createCompanyFixture, createTestHarness, type TestHarness } from './helpers/harness';
import { countJobs, drainJobs } from './helpers/jobs';
import { createWhatsAppAccount, inboundText, postWebhook } from './helpers/whatsapp';

/**
 * Recuperação de respostas travadas: quando o job `agent.reply` se perde (worker caiu, Redis
 * fora, webhook esgotou tentativas), a mensagem do cliente fica sem resposta. As falhas da IA
 * em si já têm fallback no runner; aqui cobrimos a perda do trabalho.
 */

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());
afterEach(() => vi.useRealTimers());

const T0 = new Date('2026-09-28T13:00:00Z');
const minutes = (value: number) => new Date(T0.getTime() + value * 60_000);

async function setupClinic(name = 'Clínica Bella', phoneNumberId = '555') {
  const company = await createCompanyFixture(harness, {
    name,
    ownerEmail: `dono@${phoneNumberId}.com`,
  });
  await createWhatsAppAccount(company.id, phoneNumberId);
  await systemDb.aIConfiguration.update({
    where: { companyId: company.id },
    data: { enabled: true, messageBufferSeconds: 0 },
  });
  return company;
}

/** Recebe uma mensagem e "perde" o job de resposta, como numa queda de worker/Redis. */
async function receiveAndLoseReply(phoneNumberId = '555', from = '5511988887777') {
  await postWebhook(harness, inboundText(phoneNumberId, from, 'oi, tudo bem?'));
  await drainJobs(harness, { only: ['webhook.process'] });
  expect(countJobs(harness, 'agent.reply')).toBe(1);
  harness.queue.clear();
  return systemDb.conversation.findFirstOrThrow({
    where: { contact: { phone: from } },
    orderBy: { createdAt: 'desc' },
  });
}

describe('recuperação de respostas travadas', () => {
  it('reagenda a resposta de uma mensagem esquecida e o cliente é respondido', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await setupClinic();
    await receiveAndLoseReply();

    vi.setSystemTime(minutes(15));
    const result = await recoverStalledReplies(harness.container);
    expect(result).toEqual({ rescheduled: 1, handedOff: 0 });
    expect(countJobs(harness, 'agent.reply')).toBe(1);

    harness.ai.enqueue({ text: 'Oi! Tudo ótimo, como posso ajudar?' });
    await drainJobs(harness, { only: ['agent.reply', 'message.send'] });
    expect(harness.messaging.sent).toHaveLength(1);
    expect(
      await systemDb.message.count({ where: { direction: 'INBOUND', agentHandledAt: null } }),
    ).toBe(0);

    // Já respondido: nada mais a recuperar.
    vi.setSystemTime(minutes(30));
    expect(await recoverStalledReplies(harness.container)).toEqual({
      rescheduled: 0,
      handedOff: 0,
    });
  });

  it('não age cedo demais, tarde demais, nem fora do modo IA ou com IA/empresa desligada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const company = await setupClinic();
    const conversation = await receiveAndLoseReply();

    // Ainda dentro do buffer/retries normais.
    vi.setSystemTime(minutes(5));
    expect((await recoverStalledReplies(harness.container)).rescheduled).toBe(0);

    // Fora da janela de recuperação (6h).
    vi.setSystemTime(minutes(7 * 60));
    expect((await recoverStalledReplies(harness.container)).rescheduled).toBe(0);

    vi.setSystemTime(minutes(15));
    await systemDb.conversation.update({ where: { id: conversation.id }, data: { mode: 'HUMAN' } });
    expect((await recoverStalledReplies(harness.container)).rescheduled).toBe(0);
    await systemDb.conversation.update({ where: { id: conversation.id }, data: { mode: 'AI' } });

    await systemDb.aIConfiguration.update({
      where: { companyId: company.id },
      data: { enabled: false },
    });
    expect((await recoverStalledReplies(harness.container)).rescheduled).toBe(0);
    await systemDb.aIConfiguration.update({
      where: { companyId: company.id },
      data: { enabled: true },
    });

    await systemDb.company.update({ where: { id: company.id }, data: { status: 'SUSPENDED' } });
    expect((await recoverStalledReplies(harness.container)).rescheduled).toBe(0);
    expect(countJobs(harness, 'agent.reply')).toBe(0);
  });

  it('depois de 3 execuções sem resolver, passa para humano e avisa a equipe (uma vez)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const company = await setupClinic();
    const conversation = await receiveAndLoseReply();
    for (const offset of [1, 2, 3]) {
      await systemDb.agentRun.create({
        data: {
          companyId: company.id,
          conversationId: conversation.id,
          trigger: 'INBOUND_MESSAGE',
          status: 'SUCCEEDED',
          model: 'muse-spark-1.3',
          provider: 'meta',
          startedAt: minutes(offset),
        },
      });
    }

    vi.setSystemTime(minutes(15));
    expect(await recoverStalledReplies(harness.container)).toEqual({
      rescheduled: 0,
      handedOff: 1,
    });
    expect(countJobs(harness, 'agent.reply')).toBe(0);
    expect(
      await systemDb.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).toMatchObject({ mode: 'HUMAN', status: 'WAITING_HUMAN', needsAttention: true });
    expect(
      await systemDb.notification.count({
        where: { companyId: company.id, type: 'HANDOFF_REQUESTED' },
      }),
    ).toBe(1);

    // Próximo ciclo: a conversa saiu do modo IA, sem nova notificação.
    vi.setSystemTime(minutes(20));
    expect(await recoverStalledReplies(harness.container)).toEqual({
      rescheduled: 0,
      handedOff: 0,
    });
  });

  it('trata cada empresa separadamente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await setupClinic('Clínica Bella', '555');
    await setupClinic('Barbearia Outra', '777');
    await receiveAndLoseReply('555', '5511911111111');
    await receiveAndLoseReply('777', '5511922222222');

    vi.setSystemTime(minutes(15));
    expect((await recoverStalledReplies(harness.container)).rescheduled).toBe(2);
    expect(countJobs(harness, 'agent.reply')).toBe(2);
  });
});
