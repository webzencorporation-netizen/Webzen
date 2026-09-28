import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAnthropicHomologation } from '../src/homologation';
import {
  message,
  modelInfo,
  startFakeAnthropic,
  usage,
  type FakeAnthropic,
} from './helpers/fake-anthropic';

let fake: FakeAnthropic;

beforeAll(async () => {
  fake = await startFakeAnthropic();
});
afterAll(() => fake.close());
beforeEach(() => fake.reset());

function options(overrides: Partial<Parameters<typeof runAnthropicHomologation>[0]> = {}) {
  return {
    apiKey: 'test-key-not-real',
    baseURL: fake.baseURL,
    models: ['claude-opus-5'],
    refusalFallback: true,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function toolRoundTrip() {
  fake.replies.push(
    {
      status: 200,
      body: message({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-1' },
          { type: 'tool_use', id: 'toolu_h1', name: 'get_homologation_code', input: {} },
        ],
        stop_reason: 'tool_use',
      }),
    },
    { status: 200, body: message({ content: [{ type: 'text', text: 'HML-7Q4Z' }] }) },
  );
}

describe('runAnthropicHomologation', () => {
  it('aprova modelo disponível, resposta simples e tool use pelo caminho do atendimento', async () => {
    fake.replies.push({ status: 200, body: modelInfo('claude-opus-5') });
    fake.replies.push({ status: 200, body: message() });
    toolRoundTrip();

    const report = await runAnthropicHomologation(options());

    expect(report.passed).toBe(true);
    expect(report.checks.map(({ name, status }) => [name, status])).toEqual([
      ['modelo claude-opus-5', 'ok'],
      ['preço claude-opus-5', 'ok'],
      ['resposta simples', 'ok'],
      ['tool use', 'ok'],
      ['prompt caching', 'skipped'],
    ]);
    expect(fake.captured[0]).toMatchObject({ method: 'GET', path: '/v1/models/claude-opus-5' });
    // O thinking/tool_use da iteração anterior volta intacto e o resultado da tool chega ao modelo.
    const echoed = fake.captured[3]?.body.messages as { role: string; content: unknown }[];
    expect(echoed[1]?.content).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'toolu_h1', name: 'get_homologation_code', input: {} },
    ]);
    expect(JSON.stringify(echoed[2])).toContain('HML-7Q4Z');
    expect(report.usage.inputTokens).toBe(360);
    expect(report.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('credencial inválida reprova sem chamadas pagas e sem expor a chave', async () => {
    fake.replies.push({
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    });

    const report = await runAnthropicHomologation(options());

    expect(report.passed).toBe(false);
    expect(report.checks[0]).toMatchObject({
      status: 'fail',
      detail: expect.stringMatching(/401/),
    });
    expect(report.checks.filter((check) => check.status === 'skipped')).toHaveLength(3);
    expect(fake.captured).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('test-key-not-real');
  });

  it('recusa na resposta simples reprova e informa a categoria', async () => {
    fake.replies.push({ status: 200, body: modelInfo('claude-opus-5') });
    fake.replies.push({
      status: 200,
      body: message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      }),
    });
    toolRoundTrip();

    const report = await runAnthropicHomologation(options());

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'resposta simples')).toMatchObject({
      status: 'fail',
      detail: 'stop_reason=refusal categoria=general_harms',
    });
  });

  it('modelo sem preço cadastrado gera aviso, não reprovação', async () => {
    fake.replies.push({ status: 200, body: modelInfo('claude-novo-9') });
    fake.replies.push({ status: 200, body: message({ model: 'claude-novo-9' }) });
    toolRoundTrip();

    const report = await runAnthropicHomologation(
      options({ models: ['claude-novo-9'], refusalFallback: false }),
    );

    expect(report.passed).toBe(true);
    expect(report.checks[1]).toMatchObject({ name: 'preço claude-novo-9', status: 'warn' });
  });

  it('verificação opcional de cache usa prefixo estável marcado e lê cache na segunda chamada', async () => {
    fake.replies.push({ status: 200, body: modelInfo('claude-opus-5') });
    fake.replies.push({ status: 200, body: message() });
    toolRoundTrip();
    fake.replies.push(
      {
        status: 200,
        body: message({ usage: usage(10, 2, { cache_creation_input_tokens: 6000 }) }),
      },
      { status: 200, body: message({ usage: usage(10, 2, { cache_read_input_tokens: 6000 }) }) },
    );

    const report = await runAnthropicHomologation(options({ checkCache: true }));

    expect(report.checks.at(-1)).toMatchObject({ name: 'prompt caching', status: 'ok' });
    const system = fake.captured[4]?.body.system as { cache_control?: unknown }[];
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(fake.captured[4]?.body.system).toEqual(fake.captured[5]?.body.system);
  });
});
