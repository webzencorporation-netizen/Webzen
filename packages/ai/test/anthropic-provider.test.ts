import { AIProviderError } from '@botsaas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentEngine, AnthropicProvider, type AIRequest } from '../src';
import {
  message as baseMessage,
  startFakeAnthropic,
  usage,
  type FakeAnthropic,
} from './helpers/fake-anthropic';

/**
 * Contrato do AnthropicProvider com o SDK real contra um servidor HTTP local.
 * As respostas seguem os formatos documentados da Messages API (inclusive refusal e
 * `fallbacks`); nenhuma chamada sai da máquina e nenhuma credencial real é usada.
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

function provider(overrides: { refusalFallback?: boolean } = {}) {
  return new AnthropicProvider({
    apiKey: 'test-key-not-real',
    baseURL,
    maxRetries: 0,
    timeoutMs: 5_000,
    refusalFallback: overrides.refusalFallback ?? false,
  });
}

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    model: 'claude-opus-5',
    system: [{ text: 'Instruções estáveis', cacheBreakpoint: true }, { text: 'Contexto volátil' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Qual o horário?' }] }],
    tools: [
      {
        name: 'get_business_hours',
        description: 'Horário de funcionamento',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    maxOutputTokens: 4096,
    effort: 'medium',
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return baseMessage({
    content: [{ type: 'text', text: 'Abrimos às 8h.' }],
    usage: usage(120, 30, { cache_read_input_tokens: 900, cache_creation_input_tokens: 40 }),
    ...overrides,
  });
}

describe('AnthropicProvider — requisição', () => {
  it('envia chave, cache no prefixo estável, tools e effort na Messages API padrão', async () => {
    replies.push({ status: 200, body: message() });
    await provider().complete(request());

    const [call] = captured;
    expect(call?.path).toBe('/v1/messages');
    expect(call?.headers['x-api-key']).toBe('test-key-not-real');
    expect(call?.headers['anthropic-beta']).toBeUndefined();
    expect(call?.body).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 4096,
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: 'Instruções estáveis', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Contexto volátil' },
      ],
      tools: [{ name: 'get_business_hours', input_schema: { type: 'object' } }],
    });
    expect(call?.body).not.toHaveProperty('fallbacks');
    expect(call?.body).not.toHaveProperty('thinking');
    expect((call?.body.system as Record<string, unknown>[])[1]).not.toHaveProperty('cache_control');
  });

  it('omite effort em modelos que não o aceitam', async () => {
    replies.push({ status: 200, body: message({ model: 'claude-haiku-4-5' }) });
    await provider().complete(request({ model: 'claude-haiku-4-5' }));
    expect(captured[0]?.body).not.toHaveProperty('output_config');
  });

  it('com fallback habilitado usa o beta e fallbacks "default" somente nos modelos suportados', async () => {
    replies.push({ status: 200, body: message() });
    replies.push({ status: 200, body: message({ model: 'claude-sonnet-5' }) });
    const ai = provider({ refusalFallback: true });

    await ai.complete(request());
    await ai.complete(request({ model: 'claude-sonnet-5' }));

    expect(captured[0]?.path).toBe('/v1/messages?beta=true');
    expect(captured[0]?.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(captured[0]?.body.fallbacks).toBe('default');
    expect(captured[1]?.path).toBe('/v1/messages');
    expect(captured[1]?.body).not.toHaveProperty('fallbacks');
  });
});

describe('AnthropicProvider — resposta', () => {
  it('mapeia texto, tool_use e consumo; tentativa única atendida pelo modelo pedido', async () => {
    replies.push({
      status: 200,
      body: message({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Vou consultar.' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_business_hours', input: {} },
        ],
        stop_reason: 'tool_use',
      }),
    });
    const response = await provider().complete(request());

    expect(response.stopReason).toBe('tool_use');
    expect(response.text).toBe('Vou consultar.');
    expect(response.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_business_hours', input: {} }]);
    expect(response.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
    });
    expect(response.attempts).toEqual([
      { model: 'claude-opus-5', served: true, fallback: false, usage: response.usage },
    ]);
    expect(response.refusal).toBeUndefined();
  });

  it('recusa sem fallback expõe categoria e explicação, sem texto nem tools', async () => {
    replies.push({
      status: 200,
      body: message({
        content: [],
        stop_reason: 'refusal',
        stop_details: {
          type: 'refusal',
          category: 'cyber',
          explanation: 'Declined.',
        },
        usage: usage(412, 0),
      }),
    });
    const response = await provider().complete(request());

    expect(response.stopReason).toBe('refusal');
    expect(response.text).toBe('');
    expect(response.toolCalls).toEqual([]);
    expect(response.refusal).toEqual({
      category: 'cyber',
      explanation: 'Declined.',
      recommendedModel: null,
    });
  });

  it('recusa com categoria nula continua sendo recusa', async () => {
    replies.push({
      status: 200,
      body: message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: null },
        usage: usage(10, 0),
      }),
    });
    const response = await provider().complete(request());
    expect(response.stopReason).toBe('refusal');
    expect(response.refusal).toEqual({ category: null, explanation: null, recommendedModel: null });
  });

  it('fallback server-side: registra cada tentativa de usage.iterations e o modelo que atendeu', async () => {
    replies.push({
      status: 200,
      body: message({
        model: 'claude-opus-4-8',
        content: [
          {
            type: 'fallback',
            from: { model: 'claude-opus-5' },
            to: { model: 'claude-opus-4-8' },
          },
          { type: 'text', text: 'Abrimos às 8h.' },
        ],
        usage: usage(412, 264, {
          iterations: [
            { type: 'message', model: 'claude-opus-5', ...usage(535, 0) },
            { type: 'fallback_message', model: 'claude-opus-4-8', ...usage(412, 264) },
          ],
        }),
      }),
    });
    const response = await provider({ refusalFallback: true }).complete(request());

    expect(response.model).toBe('claude-opus-4-8');
    expect(response.text).toBe('Abrimos às 8h.');
    // `usage` continua sendo somente a tentativa que produziu a resposta (semântica da API).
    expect(response.usage.inputTokens).toBe(412);
    expect(response.attempts).toEqual([
      {
        model: 'claude-opus-5',
        served: false,
        fallback: false,
        usage: { inputTokens: 535, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      {
        model: 'claude-opus-4-8',
        served: true,
        fallback: true,
        usage: { inputTokens: 412, outputTokens: 264, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  it('roteamento sticky: tentativa única marcada como fallback', async () => {
    replies.push({
      status: 200,
      body: message({
        model: 'claude-opus-4-8',
        usage: usage(50, 5, {
          iterations: [{ type: 'fallback_message', model: 'claude-opus-4-8', ...usage(50, 5) }],
        }),
      }),
    });
    const response = await provider({ refusalFallback: true }).complete(request());
    expect(response.attempts).toEqual([
      {
        model: 'claude-opus-4-8',
        served: true,
        fallback: true,
        usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  it('cadeia inteira recusada: recomendação de modelo preservada', async () => {
    replies.push({
      status: 200,
      body: message({
        content: [],
        stop_reason: 'refusal',
        stop_details: {
          type: 'refusal',
          category: 'bio',
          explanation: null,
          recommended_model: 'claude-opus-4-8',
        },
        usage: usage(300, 0, {
          iterations: [{ type: 'message', model: 'claude-opus-5', ...usage(300, 0) }],
        }),
      }),
    });
    const response = await provider({ refusalFallback: true }).complete(request());
    expect(response.stopReason).toBe('refusal');
    expect(response.refusal).toEqual({
      category: 'bio',
      explanation: null,
      recommendedModel: 'claude-opus-4-8',
    });
  });

  it('loop de tools devolve o bloco fallback na mesma posição na iteração seguinte', async () => {
    const fallbackBlock = {
      type: 'fallback',
      from: { model: 'claude-opus-5' },
      to: { model: 'claude-opus-4-8' },
    };
    replies.push({
      status: 200,
      body: message({
        model: 'claude-opus-4-8',
        content: [
          fallbackBlock,
          { type: 'tool_use', id: 'toolu_9', name: 'get_business_hours', input: {} },
        ],
        stop_reason: 'tool_use',
      }),
    });
    replies.push({ status: 200, body: message({ model: 'claude-opus-4-8' }) });

    const result = await AgentEngine.run({
      provider: provider({ refusalFallback: true }),
      model: 'claude-opus-5',
      system: [{ text: 'Sistema' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Horário?' }] }],
      tools: [
        {
          name: 'get_business_hours',
          description: 'Horário',
          inputSchema: z.object({}),
          mutating: false,
          handler: async () => ({ ok: true, data: { opens: '08:00' } }),
        },
      ],
      toolContext: {},
      maxIterations: 3,
      maxOutputTokens: 1024,
      meta: { dryRun: true },
    });

    expect(result.outcome).toBe('answered');
    const echoed = captured[1]?.body.messages as { role: string; content: unknown[] }[];
    expect(echoed[1]).toEqual({
      role: 'assistant',
      content: [
        fallbackBlock,
        { type: 'tool_use', id: 'toolu_9', name: 'get_business_hours', input: {} },
      ],
    });
  });
});

describe('AnthropicProvider — erros', () => {
  const cases: { status: number; type: string; retryable: boolean }[] = [
    { status: 400, type: 'invalid_request_error', retryable: false },
    { status: 401, type: 'authentication_error', retryable: false },
    { status: 403, type: 'permission_error', retryable: false },
    { status: 404, type: 'not_found_error', retryable: false },
    { status: 429, type: 'rate_limit_error', retryable: true },
    { status: 500, type: 'api_error', retryable: true },
    { status: 529, type: 'overloaded_error', retryable: true },
  ];

  for (const { status, type, retryable } of cases) {
    it(`HTTP ${status} vira AIProviderError retryable=${retryable}`, async () => {
      replies.push({
        status,
        body: { type: 'error', error: { type, message: 'detalhe' } },
      });
      const failure = await provider()
        .complete(request())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AIProviderError);
      expect((failure as AIProviderError).retryable).toBe(retryable);
      expect((failure as Error).message).not.toContain('test-key-not-real');
    });
  }

  it('falha de conexão é retryable', async () => {
    const offline = new AnthropicProvider({
      apiKey: 'test-key-not-real',
      baseURL: 'http://127.0.0.1:1',
      maxRetries: 0,
      timeoutMs: 2_000,
    });
    const failure = await offline.complete(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect((failure as AIProviderError).retryable).toBe(true);
  });
});
