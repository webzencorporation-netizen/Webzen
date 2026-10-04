import { AIProviderError } from '@botsaas/shared';
import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider, type AIRequest } from '../src';

const KEY = 'gemini-test-key-not-real';

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    model: 'gemini-2.5-flash',
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

function setup(...bodies: { status?: number; body: unknown }[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const reply of bodies) {
    fetchImpl.mockResolvedValueOnce(Response.json(reply.body, { status: reply.status ?? 200 }));
  }
  return { fetchImpl, provider: new GeminiProvider({ apiKey: KEY, fetchImpl }) };
}

function sentBody(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) {
  return JSON.parse(String(fetchImpl.mock.calls[call]![1]!.body)) as Record<string, unknown>;
}

const toolCallReply = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [
          { text: 'pensando…', thought: true },
          { functionCall: { name: 'get_business_hours', args: {} }, thoughtSignature: 'assinatura' },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 10, thoughtsTokenCount: 40 },
  modelVersion: 'gemini-2.5-flash',
};

describe('GeminiProvider', () => {
  it('monta a requisição: sistema, tools com JSON Schema, chave no cabeçalho e folga de raciocínio', async () => {
    const { fetchImpl, provider } = setup({ body: toolCallReply });
    await provider.complete(request());

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(KEY);
    expect(sentBody(fetchImpl)).toEqual({
      systemInstruction: { parts: [{ text: 'Instruções estáveis\n\nContexto volátil' }] },
      contents: [{ role: 'user', parts: [{ text: 'Qual o horário?' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'get_business_hours',
              description: 'Horário de funcionamento',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 1024 + 2048 },
    });
  });

  it('chamada de ferramenta: devolve tool_use, ignora o raciocínio no texto e conta os tokens', async () => {
    const { provider } = setup({ body: toolCallReply });
    const result = await provider.complete(request());
    expect(result.stopReason).toBe('tool_use');
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([
      { id: 'call_1_get_business_hours', name: 'get_business_hours', input: {} },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('loop de tools: reenvia o conteúdo do modelo intacto e o resultado com nome e id', async () => {
    const { fetchImpl, provider } = setup(
      { body: toolCallReply },
      {
        body: {
          candidates: [
            { content: { role: 'model', parts: [{ text: 'Abrimos às 9h.' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 6, cachedContentTokenCount: 50 },
        },
      },
    );
    const first = await provider.complete(request());
    const second = await provider.complete(
      request({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Qual o horário?' }] },
          { role: 'assistant', raw: first.rawAssistantContent },
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: first.toolCalls[0]!.id, content: '{"open":"09:00"}' },
            ],
          },
        ],
      }),
    );

    expect(sentBody(fetchImpl, 1).contents).toEqual([
      { role: 'user', parts: [{ text: 'Qual o horário?' }] },
      {
        role: 'model',
        parts: [
          { text: 'pensando…', thought: true },
          {
            functionCall: { id: 'call_1_get_business_hours', name: 'get_business_hours', args: {} },
            thoughtSignature: 'assinatura',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_1_get_business_hours',
              name: 'get_business_hours',
              response: { open: '09:00' },
            },
          },
        ],
      },
    ]);
    expect(second.text).toBe('Abrimos às 9h.');
    expect(second.stopReason).toBe('end_turn');
    expect(second.usage).toMatchObject({ inputTokens: 150, cacheReadTokens: 50, outputTokens: 6 });
  });

  it('histórico em texto vira papel model; bloqueio de segurança vira recusa', async () => {
    const { fetchImpl, provider } = setup({
      body: { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
    });
    const result = await provider.complete(
      request({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Oi' }] },
          { role: 'assistant', content: 'Olá! Como posso ajudar?' },
          { role: 'user', content: [{ type: 'text', text: 'Quero agendar' }] },
        ],
        tools: [],
      }),
    );
    expect(sentBody(fetchImpl).contents).toEqual([
      { role: 'user', parts: [{ text: 'Oi' }] },
      { role: 'model', parts: [{ text: 'Olá! Como posso ajudar?' }] },
      { role: 'user', parts: [{ text: 'Quero agendar' }] },
    ]);
    expect(sentBody(fetchImpl).tools).toBeUndefined();
    expect(result.stopReason).toBe('refusal');
    expect(result.refusal?.category).toBe('SAFETY');
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
  ])('HTTP %i vira AIProviderError retryable=%s sem expor a chave', async (status, retryable) => {
    const { provider } = setup({
      status,
      body: { error: { code: status, message: 'detalhe do Google', status: 'X' } },
    });
    const failure = await provider.complete(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect((failure as AIProviderError).retryable).toBe(retryable);
    expect((failure as Error).message).toContain('Gemini');
    expect((failure as Error).message).not.toContain(KEY);
  });

  it('cota ou alta demanda: segue para o próximo modelo e registra as tentativas', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(Response.json({ error: { message: 'quota' } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'high demand' } }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [{ content: { parts: [{ text: 'Oi!' }] }, finishReason: 'STOP' }],
          modelVersion: 'gemini-3.1-flash-lite',
        }),
      );
    const provider = new GeminiProvider({
      apiKey: KEY,
      fetchImpl,
      fallbackModels: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
    });
    const result = await provider.complete(request({ model: 'gemini-3.8-flash' }));
    expect(fetchImpl.mock.calls.map(([url]) => String(url).match(/models\/(.+):/)?.[1])).toEqual([
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ]);
    expect(result.text).toBe('Oi!');
    expect(result.model).toBe('gemini-3.1-flash-lite');
    expect(result.attempts.map((attempt) => [attempt.model, attempt.served, attempt.fallback])).toEqual([
      ['gemini-3.8-flash', false, false],
      ['gemini-3.5-flash', false, true],
      ['gemini-3.1-flash-lite', true, true],
    ]);
  });

  it('todos os modelos saturados: erro retryable; outros erros não trocam de modelo', async () => {
    const quota = () => Response.json({ error: { message: 'quota' } }, { status: 429 });
    const saturated = vi.fn<typeof fetch>().mockImplementation(async () => quota());
    const failure = await new GeminiProvider({ apiKey: KEY, fetchImpl: saturated, fallbackModels: ['b'] })
      .complete(request({ model: 'a' }))
      .catch((error: unknown) => error);
    expect((failure as AIProviderError).retryable).toBe(true);
    expect(saturated).toHaveBeenCalledTimes(2);

    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { message: 'bad' } }, { status: 400 }));
    await new GeminiProvider({ apiKey: KEY, fetchImpl: invalid, fallbackModels: ['b'] })
      .complete(request({ model: 'a' }))
      .catch(() => undefined);
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('conteúdo de outro modelo: troca a assinatura de raciocínio pelo marcador e tira o pensamento', async () => {
    const { fetchImpl, provider } = setup(
      { body: toolCallReply },
      { body: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } },
    );
    const first = await provider.complete(request({ model: 'gemini-3.5-flash' }));
    await provider.complete(
      request({
        model: 'gemini-3.8-flash',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Qual o horário?' }] },
          { role: 'assistant', raw: first.rawAssistantContent },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: first.toolCalls[0]!.id, content: '{}' }],
          },
        ],
      }),
    );
    const contents = sentBody(fetchImpl, 1).contents as { parts: Record<string, unknown>[] }[];
    expect(contents[1]!.parts).toEqual([
      {
        functionCall: { id: 'call_1_get_business_hours', name: 'get_business_hours', args: {} },
        thoughtSignature: 'skip_thought_signature_validator',
      },
    ]);
  });

  it('falha de rede é retryable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const failure = await new GeminiProvider({ apiKey: KEY, fetchImpl })
      .complete(request())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect((failure as AIProviderError).retryable).toBe(true);
  });
});
