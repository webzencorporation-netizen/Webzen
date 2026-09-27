import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentEngine, MockAIProvider, ToolRegistry, type ToolDefinition } from '../src';

interface Ctx {
  companyId: string;
  calls: string[];
}

function makeTools(): ToolDefinition<Ctx>[] {
  const registry = new ToolRegistry<Ctx>()
    .register({
      name: 'search_services',
      description: 'busca serviços',
      inputSchema: z.object({ query: z.string() }),
      mutating: false,
      handler: async (input, ctx) => {
        ctx.calls.push(`search:${input.query}`);
        return { ok: true, data: [{ name: 'Limpeza de pele', price: 'R$ 150,00' }] };
      },
    })
    .register({
      name: 'request_human_handoff',
      description: 'handoff',
      inputSchema: z.object({ reason: z.string() }),
      mutating: true,
      handler: async (input) => ({
        ok: true,
        data: { transferred: true },
        effects: { handoff: { reason: input.reason } },
      }),
    })
    .register({
      name: 'forbidden_tool',
      description: 'negada',
      inputSchema: z.object({}),
      mutating: true,
      authorize: () => false,
      handler: async () => ({ ok: true, data: 'nunca' }),
    })
    .register({
      name: 'boom',
      description: 'explode',
      inputSchema: z.object({}),
      mutating: false,
      handler: async () => {
        throw new Error('db down with secret details');
      },
    });
  return registry.resolve(registry.names());
}

const baseInput = (provider: MockAIProvider, ctx: Ctx) => ({
  provider,
  model: 'claude-opus-5',
  system: [{ text: 'sys', cacheBreakpoint: true }],
  messages: [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'quanto custa limpeza de pele?' }],
    },
  ],
  tools: makeTools(),
  toolContext: ctx,
  maxIterations: 4,
  maxOutputTokens: 1024,
  meta: { dryRun: false },
});

describe('AgentEngine', () => {
  it('executa tool, devolve resultado e produz resposta final', async () => {
    const provider = new MockAIProvider().enqueue(
      { toolCalls: [{ name: 'search_services', input: { query: 'limpeza de pele' } }] },
      { text: 'A limpeza de pele custa R$ 150,00.' },
    );
    const ctx: Ctx = { companyId: 'c1', calls: [] };
    const result = await AgentEngine.run(baseInput(provider, ctx));
    expect(result.outcome).toBe('answered');
    expect(result.text).toBe('A limpeza de pele custa R$ 150,00.');
    expect(result.iterations).toBe(2);
    expect(ctx.calls).toEqual(['search:limpeza de pele']);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'search_services', ok: true }),
    ]);
    // O segundo request contém o turno do assistente (raw) e o tool_result numa única mensagem user.
    const second = provider.requests[1];
    expect(second?.messages.at(-2)).toMatchObject({ role: 'assistant' });
    expect(second?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', isError: false }],
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('retorna erro estruturado para input inválido, tool desconhecida, negada e exceção', async () => {
    const provider = new MockAIProvider().enqueue(
      {
        toolCalls: [
          { name: 'search_services', input: { query: 123 } },
          { name: 'forbidden_tool', input: {} },
          { name: 'boom', input: {} },
        ],
      },
      { text: 'Tive um problema, vou chamar a equipe.' },
    );
    const ctx: Ctx = { companyId: 'c1', calls: [] };
    const result = await AgentEngine.run(baseInput(provider, ctx));
    expect(result.toolCalls.map((call) => [call.name, call.ok, call.errorCode])).toEqual(
      expect.arrayContaining([
        ['search_services', false, 'invalid_input'],
        ['forbidden_tool', false, 'forbidden'],
        ['boom', false, 'internal_error'],
      ]),
    );
    const toolResults = provider.requests[1]?.messages.at(-1);
    const serialized = JSON.stringify(toolResults);
    expect(serialized).not.toContain('secret details');
    expect(ctx.calls).toEqual([]);
  });

  it('ignora tools não registradas pedidas pelo modelo', async () => {
    const provider = new MockAIProvider().enqueue(
      { toolCalls: [{ name: 'run_sql', input: { sql: 'drop table' } }] },
      { text: 'ok' },
    );
    const result = await AgentEngine.run(baseInput(provider, { companyId: 'c1', calls: [] }));
    // O mock só emite tools que existem na requisição; o modelo nunca vê run_sql.
    expect(provider.requests[0]?.tools.map((tool) => tool.name)).not.toContain('run_sql');
    expect(result.outcome).toBe('answered');
  });

  it('propaga efeito de handoff', async () => {
    const provider = new MockAIProvider().enqueue(
      { toolCalls: [{ name: 'request_human_handoff', input: { reason: 'cliente pediu' } }] },
      { text: 'Vou te transferir para a equipe.' },
    );
    const result = await AgentEngine.run(baseInput(provider, { companyId: 'c1', calls: [] }));
    expect(result.outcome).toBe('handoff');
    expect(result.effects.handoff).toEqual({ reason: 'cliente pediu' });
  });

  it('não inventa resposta quando o limite de iterações estoura', async () => {
    const provider = new MockAIProvider();
    for (let index = 0; index < 5; index += 1) {
      provider.enqueue({ toolCalls: [{ name: 'search_services', input: { query: 'x' } }] });
    }
    const result = await AgentEngine.run({
      ...baseInput(provider, { companyId: 'c1', calls: [] }),
      maxIterations: 3,
    });
    expect(result.outcome).toBe('max_iterations');
    expect(result.text).toBe('');
    expect(provider.requests).toHaveLength(3);
  });

  it('trata recusa do provedor', async () => {
    const provider = new MockAIProvider().enqueue({ refusal: true });
    const result = await AgentEngine.run(baseInput(provider, { companyId: 'c1', calls: [] }));
    expect(result.outcome).toBe('refused');
    expect(result.text).toBe('');
  });

  it('propaga erro do provedor para o orquestrador decidir retry', async () => {
    const provider = new MockAIProvider().enqueue({ error: new Error('overloaded') });
    await expect(
      AgentEngine.run(baseInput(provider, { companyId: 'c1', calls: [] })),
    ).rejects.toThrow('overloaded');
  });
});
