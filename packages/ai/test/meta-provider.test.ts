import { AIProviderError } from '@botsaas/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentEngine,
  META_MODEL_API_BASE_URL,
  MetaModelProvider,
  metaMaxTokens,
  type AIRequest,
} from '../src';
import {
  message as baseMessage,
  startFakeAnthropic,
  usage,
  type FakeAnthropic,
} from './helpers/fake-anthropic';

/**
 * Contrato do MetaModelProvider com o SDK real contra um servidor HTTP local, com respostas
 * no formato observado na Meta Model API (blocos `redacted_thinking`, `thinking_tokens`).
 * Nenhuma chamada sai da máquina e nenhuma credencial real é usada.
 */

let fake: FakeAnthropic;
let baseURL: string;
let captured: FakeAnthropic['captured'];
let replies: FakeAnthropic['replies'];

beforeAll(async () => {
  fake = await startFakeAnthropic();
  ({ baseURL, captured, replies } = fake);
});

afterAll(() => fake.close());

beforeEach(() => fake.reset());

const KEY = 'meta-test-key-not-real';

function provider() {
  return new MetaModelProvider({ apiKey: KEY, baseURL, maxRetries: 0, timeoutMs: 5_000 });
}

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    model: 'muse-spark-1.3',
    system: [{ text: 'Instruções estáveis', cacheBreakpoint: true }, { text: 'Contexto volátil' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Qual o horário?' }] }],
    tools: [
      {
        name: 'get_business_hours',
        description: 'Horário de funcionamento',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    maxOutputTokens: 1024,
    ...overrides,
  };
}

const REDACTED = { type: 'redacted_thinking', data: 'opaco-da-meta' };

function message(overrides: Record<string, unknown> = {}) {
  return baseMessage({
    model: 'muse-spark-1.3',
    usage: usage(120, 330, { output_tokens_details: { thinking_tokens: 300 } }),
    ...overrides,
  });
}

describe('MetaModelProvider — requisição', () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  });

  it('autentica com Bearer e nunca envia a chave da Anthropic do ambiente', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-secret-must-not-leak';
    replies.push({ status: 200, body: message() });
    await provider().complete(request());

    const [call] = captured;
    expect(call?.path).toBe('/v1/messages');
    expect(call?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call?.headers['x-api-key']).toBeUndefined();
    expect(JSON.stringify(call?.headers)).not.toContain('anthropic-secret-must-not-leak');
  });

  it('envia effort explícito, folga de raciocínio e nada específico da Anthropic', async () => {
    replies.push({ status: 200, body: message() });
    await provider().complete(request());

    const [call] = captured;
    expect(call?.headers['anthropic-beta']).toBeUndefined();
    expect(call?.body).toMatchObject({
      model: 'muse-spark-1.3',
      max_tokens: 1024 + 4096,
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: 'Instruções estáveis' },
        { type: 'text', text: 'Contexto volátil' },
      ],
      tools: [{ name: 'get_business_hours', input_schema: { type: 'object', properties: {} } }],
    });
    expect(JSON.stringify(call?.body)).not.toContain('cache_control');
    expect(call?.body).not.toHaveProperty('tool_choice');
    expect(call?.body).not.toHaveProperty('fallbacks');
    expect(call?.body).not.toHaveProperty('thinking');
  });

  it('folga de raciocínio acompanha o effort pedido e respeita o mínimo da API', async () => {
    replies.push({ status: 200, body: message() }, { status: 200, body: message() });
    await provider().complete(request({ effort: 'low', tools: [] }));
    await provider().complete(request({ effort: 'high', tools: [] }));

    expect(captured[0]?.body).toMatchObject({
      max_tokens: 1024 + 2048,
      output_config: { effort: 'low' },
    });
    expect(captured[0]?.body).not.toHaveProperty('tools');
    expect(captured[1]?.body).toMatchObject({
      max_tokens: 1024 + 8192,
      output_config: { effort: 'high' },
    });
    expect(metaMaxTokens(0, 'low')).toBeGreaterThanOrEqual(16);
  });

  it('usa a URL oficial da Meta por padrão', () => {
    expect(META_MODEL_API_BASE_URL).toBe('https://api.meta.ai');
  });
});

describe('MetaModelProvider — resposta', () => {
  it('mapeia texto e tool_use ignorando o raciocínio redigido; consumo inclui o raciocínio', async () => {
    replies.push({
      status: 200,
      body: message({
        content: [
          REDACTED,
          { type: 'text', text: 'Consultando.' },
          { type: 'tool_use', id: 'call_1', name: 'get_business_hours', input: {} },
        ],
        stop_reason: 'tool_use',
      }),
    });
    const response = await provider().complete(request());

    expect(response.text).toBe('Consultando.');
    expect(response.toolCalls).toEqual([{ id: 'call_1', name: 'get_business_hours', input: {} }]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toEqual({
      inputTokens: 120,
      outputTokens: 330,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(response.attempts).toEqual([
      { model: 'muse-spark-1.3', served: true, fallback: false, usage: response.usage },
    ]);
    expect(response.rawAssistantContent).toContainEqual(REDACTED);
  });

  it('loop completo: executa várias tools, devolve resultados e reenvia o raciocínio intacto', async () => {
    replies.push(
      {
        status: 200,
        body: message({
          content: [
            REDACTED,
            { type: 'tool_use', id: 'call_a', name: 'get_business_hours', input: {} },
            { type: 'tool_use', id: 'call_b', name: 'get_price', input: { service: 'consulta' } },
          ],
          stop_reason: 'tool_use',
        }),
      },
      {
        status: 200,
        body: message({
          content: [REDACTED, { type: 'text', text: 'Sábado 8h–12h; consulta R$ 180.' }],
          stop_reason: 'end_turn',
        }),
      },
    );
    const executed: string[] = [];
    const result = await AgentEngine.run({
      provider: provider(),
      model: 'muse-spark-1.3',
      system: [{ text: 'Atendente.' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Horário e preço?' }] }],
      tools: [
        {
          name: 'get_business_hours',
          description: 'Horário',
          inputSchema: z.object({}),
          mutating: false,
          handler: async () => {
            executed.push('hours');
            return { ok: true, data: { saturday: '08:00-12:00' } };
          },
        },
        {
          name: 'get_price',
          description: 'Preço',
          inputSchema: z.object({ service: z.string() }),
          mutating: false,
          handler: async (input) => {
            executed.push(`price:${(input as { service: string }).service}`);
            return { ok: true, data: { price: 'R$ 180' } };
          },
        },
      ],
      toolContext: {},
      maxIterations: 3,
      maxOutputTokens: 1024,
      effort: 'low',
      meta: { dryRun: true },
    });

    expect(result.outcome).toBe('answered');
    expect(result.text).toBe('Sábado 8h–12h; consulta R$ 180.');
    expect(executed.sort()).toEqual(['hours', 'price:consulta']);
    expect(result.toolCalls.map((call) => call.name)).toEqual(['get_business_hours', 'get_price']);

    const second = captured[1]?.body as { messages: { role: string; content: unknown }[] };
    const [, assistant, toolResults] = second.messages;
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.content).toContainEqual(REDACTED);
    expect(toolResults).toMatchObject({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_a' },
        { type: 'tool_result', tool_use_id: 'call_b' },
      ],
    });
  });

  it('resposta cortada por max_tokens vira outcome truncated', async () => {
    replies.push({
      status: 200,
      body: message({ content: [REDACTED], stop_reason: 'max_tokens' }),
    });
    const result = await AgentEngine.run({
      provider: provider(),
      model: 'muse-spark-1.3',
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Conte uma história longa.' }] }],
      tools: [],
      toolContext: {},
      maxIterations: 2,
      maxOutputTokens: 16,
      meta: { dryRun: true },
    });
    expect(result.outcome).toBe('truncated');
    expect(result.stopReason).toBe('max_tokens');
  });
});

describe('MetaModelProvider — erros', () => {
  const cases: { status: number; type: string; retryable: boolean }[] = [
    { status: 400, type: 'invalid_request_error', retryable: false },
    { status: 401, type: 'authentication_error', retryable: false },
    { status: 403, type: 'permission_error', retryable: false },
    { status: 404, type: 'not_found_error', retryable: false },
    { status: 429, type: 'rate_limit_error', retryable: true },
    { status: 500, type: 'api_error', retryable: true },
    { status: 502, type: 'api_error', retryable: true },
    { status: 503, type: 'api_error', retryable: true },
  ];

  for (const { status, type, retryable } of cases) {
    it(`HTTP ${status} vira AIProviderError retryable=${retryable} nomeando a Meta`, async () => {
      replies.push({ status, body: { type: 'error', error: { type, message: 'detalhe' } } });
      const failure = await provider()
        .complete(request())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AIProviderError);
      expect((failure as AIProviderError).retryable).toBe(retryable);
      expect((failure as Error).message).toContain('Meta');
      expect((failure as Error).message).not.toContain(KEY);
    });
  }

  it('falha de conexão é retryable', async () => {
    const offline = new MetaModelProvider({
      apiKey: KEY,
      baseURL: 'http://127.0.0.1:1',
      maxRetries: 0,
      timeoutMs: 2_000,
    });
    const failure = await offline.complete(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect((failure as AIProviderError).retryable).toBe(true);
    expect((failure as Error).message).toContain('Meta');
  });
});
