import Anthropic from '@anthropic-ai/sdk';
import { AIProviderError } from '@botsaas/shared';
import { z } from 'zod';
import { AgentEngine } from './engine';
import type { HomologationCheck, HomologationReport } from './homologation';
import { DEFAULT_MODEL_PRICING, estimateCostUsd } from './pricing';
import { createMetaClient, MetaModelProvider } from './provider/meta';
import { addUsage, emptyUsage, type AIEffort, type AIUsage } from './provider/types';

/**
 * Homologação da Meta Model API (Muse Spark): poucas chamadas pequenas e PAGAS pelo mesmo
 * caminho do atendimento (MetaModelProvider + AgentEngine + tools), mais verificações das
 * diferenças de compatibilidade documentadas em `provider/meta.ts`. Nunca registra a chave.
 */

export interface MetaHomologationOptions {
  apiKey: string;
  /** Modelos configurados (padrão e resumo), sem repetição. */
  models: string[];
  baseURL?: string;
  timeoutMs?: number;
}

const CODE_A = 'HML-7Q4Z';
const CODE_B = 'HML-3K8P';

function describeError(error: unknown): string {
  const cause = error instanceof AIProviderError ? error.cause : error;
  if (cause instanceof Anthropic.APIError) return `HTTP ${cause.status ?? '?'}: ${cause.message}`;
  return error instanceof Error ? error.message : String(error);
}

function statusOf(error: unknown): number | undefined {
  const cause = error instanceof AIProviderError ? error.cause : error;
  return cause instanceof Anthropic.APIError ? cause.status : undefined;
}

const userText = (text: string) => [
  { role: 'user' as const, content: [{ type: 'text' as const, text }] },
];

export async function runMetaHomologation(
  options: MetaHomologationOptions,
): Promise<HomologationReport> {
  const checks: HomologationCheck[] = [];
  let usage = emptyUsage();
  let estimatedCostUsd = 0;
  const account = (model: string, delta: AIUsage) => {
    usage = addUsage(usage, delta);
    estimatedCostUsd += estimateCostUsd(delta, DEFAULT_MODEL_PRICING[model]);
  };
  const accountRaw = (model: string, raw: Anthropic.Usage) =>
    account(model, {
      inputTokens: raw.input_tokens,
      outputTokens: raw.output_tokens,
      cacheReadTokens: raw.cache_read_input_tokens ?? 0,
      cacheWriteTokens: raw.cache_creation_input_tokens ?? 0,
    });
  const run = async (name: string, check: () => Promise<Omit<HomologationCheck, 'name'>>) => {
    try {
      checks.push({ name, ...(await check()) });
    } catch (error) {
      checks.push({ name, status: 'fail', detail: describeError(error) });
    }
  };

  const connection = {
    apiKey: options.apiKey,
    maxRetries: 1,
    timeoutMs: options.timeoutMs ?? 120_000,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  };
  const client = createMetaClient(connection);
  const provider = new MetaModelProvider(connection);

  const available: string[] = [];
  for (const candidate of options.models) {
    await run(`modelo ${candidate}`, async () => {
      await client.models.retrieve(candidate);
      available.push(candidate);
      return { status: 'ok', detail: 'disponível' };
    });
    checks.push(
      DEFAULT_MODEL_PRICING[candidate]
        ? { name: `preço ${candidate}`, status: 'ok', detail: 'presente na tabela padrão' }
        : {
            name: `preço ${candidate}`,
            status: 'warn',
            detail: 'ausente da tabela padrão: custo estimado será zero até cadastrar o preço',
          },
    );
  }

  const model = available[0];
  if (!model) {
    checks.push({
      name: 'chamadas ao modelo',
      status: 'skipped',
      detail: 'nenhum modelo configurado disponível (verifique a chave e AI_DEFAULT_MODEL)',
    });
    return { checks, usage, estimatedCostUsd, passed: false };
  }

  await run('conversa normal', async () => {
    const response = await provider.complete({
      model,
      system: [{ text: 'Você é atendente de uma clínica. Responda em português, em uma frase.' }],
      messages: userText('Oi, tudo bem?'),
      tools: [],
      maxOutputTokens: 512,
      effort: 'low',
    });
    account(model, response.usage);
    const ok = response.stopReason === 'end_turn' && response.text.length > 0;
    return {
      status: ok ? 'ok' : 'fail',
      detail: ok
        ? `"${response.text.slice(0, 80)}"; ${response.usage.inputTokens} in / ${response.usage.outputTokens} out`
        : `stop_reason=${response.stopReason}`,
    };
  });

  for (const effort of ['low', 'medium', 'high'] as AIEffort[]) {
    await run(`raciocínio effort=${effort}`, async () => {
      const response = await provider.complete({
        model,
        system: [{ text: 'Responda apenas "OK".' }],
        messages: userText('Verificação.'),
        tools: [],
        maxOutputTokens: 256,
        effort,
      });
      account(model, response.usage);
      const ok = response.stopReason === 'end_turn' && response.text.length > 0;
      return {
        status: ok ? 'ok' : 'fail',
        detail: `aceito; stop_reason=${response.stopReason}; ${response.usage.outputTokens} tokens de saída (inclui raciocínio)`,
      };
    });
  }

  await run('raciocínio desligado (thinking: disabled)', async () => {
    try {
      await client.messages.create({
        model,
        max_tokens: 64,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: 'Verificação.' }],
      });
      return {
        status: 'warn',
        detail: 'agora é aceito pela Meta; a folga de raciocínio do provider pode ser revista',
      };
    } catch (error) {
      if (statusOf(error) !== 400) throw error;
      return { status: 'ok', detail: 'recusado com 400, como esperado; o provider nunca envia' };
    }
  });

  await run('tool calling completo', async () => {
    let calls = 0;
    const result = await AgentEngine.run({
      provider,
      model,
      system: [
        {
          text: 'Verificação técnica. Use a ferramenta para obter o código e responda somente com ele.',
        },
      ],
      messages: userText('Qual é o código?'),
      tools: [
        {
          name: 'get_homologation_code',
          description: 'Retorna o código da verificação técnica.',
          inputSchema: z.object({}),
          mutating: false,
          handler: async () => {
            calls += 1;
            return { ok: true, data: { code: CODE_A } };
          },
        },
      ],
      toolContext: {},
      maxIterations: 3,
      maxOutputTokens: 512,
      effort: 'low',
      meta: { dryRun: true },
    });
    for (const attempt of result.attempts) account(attempt.model, attempt.usage);
    const ok = result.outcome === 'answered' && calls >= 1 && result.text.includes(CODE_A);
    return {
      status: ok ? 'ok' : 'fail',
      detail: `outcome=${result.outcome}; execuções=${calls}; iterações=${result.iterations}; resposta="${result.text.slice(0, 60)}"`,
    };
  });

  await run('múltiplas chamadas de ferramenta', async () => {
    const called = new Set<string>();
    const tool = (name: string, description: string, code: string) => ({
      name,
      description,
      inputSchema: z.object({}),
      mutating: false,
      handler: async () => {
        called.add(name);
        return { ok: true as const, data: { code } };
      },
    });
    const result = await AgentEngine.run({
      provider,
      model,
      system: [
        {
          text: 'Verificação técnica. Obtenha os DOIS códigos com as ferramentas e responda somente com os dois, separados por espaço.',
        },
      ],
      messages: userText('Quais são os códigos A e B?'),
      tools: [
        tool('get_code_a', 'Retorna o código A.', CODE_A),
        tool('get_code_b', 'Retorna o código B.', CODE_B),
      ],
      toolContext: {},
      maxIterations: 4,
      maxOutputTokens: 512,
      effort: 'low',
      meta: { dryRun: true },
    });
    for (const attempt of result.attempts) account(attempt.model, attempt.usage);
    const ok =
      result.outcome === 'answered' &&
      called.size === 2 &&
      result.text.includes(CODE_A) &&
      result.text.includes(CODE_B);
    return {
      status: ok ? 'ok' : 'fail',
      detail: `ferramentas=${[...called].join(',') || 'nenhuma'}; chamadas=${result.toolCalls.length}; iterações=${result.iterations}; outcome=${result.outcome}`,
    };
  });

  await run('limite de tokens', async () => {
    const response = await client.messages.create({
      model,
      max_tokens: 16,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Escreva um parágrafo sobre o mar.' }],
    });
    accountRaw(model, response.usage);
    let minimum: string;
    try {
      await client.messages.create({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Verificação.' }],
      });
      minimum = 'max_tokens=8 aceito';
    } catch (error) {
      if (statusOf(error) !== 400) throw error;
      minimum = 'max_tokens < 16 recusado com 400';
    }
    return {
      status: response.stop_reason === 'max_tokens' ? 'ok' : 'fail',
      detail: `max_tokens=16 → stop_reason=${response.stop_reason} (${response.usage.output_tokens} tokens); ${minimum}`,
    };
  });

  await run('streaming', async () => {
    let deltas = 0;
    const stream = client.messages.stream({
      model,
      max_tokens: 2048,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Diga oi em português, em uma frase.' }],
    });
    stream.on('text', () => {
      deltas += 1;
    });
    const final = await stream.finalMessage();
    accountRaw(model, final.usage);
    const text = final.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const ok = final.stop_reason === 'end_turn' && text.length > 0 && deltas > 0;
    return {
      status: ok ? 'ok' : 'fail',
      detail: `${deltas} evento(s) de texto; "${text.slice(0, 60)}" (o atendimento não usa streaming: a mensagem do WhatsApp é enviada inteira)`,
    };
  });

  await run('tool_choice', async () => {
    const tools = [
      {
        name: 'get_code',
        description: 'Retorna um código.',
        input_schema: { type: 'object' as const, properties: {} },
      },
    ];
    const auto = await client.messages.create({
      model,
      max_tokens: 2048,
      output_config: { effort: 'low' },
      tools,
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: 'Use a ferramenta para obter o código.' }],
    });
    accountRaw(model, auto.usage);
    const rejected: string[] = [];
    for (const choice of [{ type: 'any' }, { type: 'tool', name: 'get_code' }] as const) {
      try {
        const forced = await client.messages.create({
          model,
          max_tokens: 2048,
          output_config: { effort: 'low' },
          tools,
          tool_choice: choice,
          messages: [{ role: 'user', content: 'Verificação.' }],
        });
        accountRaw(model, forced.usage);
      } catch (error) {
        if (statusOf(error) !== 400) throw error;
        rejected.push(choice.type);
      }
    }
    return {
      status: rejected.length === 2 ? 'ok' : 'warn',
      detail:
        `auto aceito (stop_reason=${auto.stop_reason}); ` +
        (rejected.length === 2
          ? 'any/tool recusados com 400, como esperado — o provider nunca envia tool_choice'
          : `recusados: ${rejected.join(',') || 'nenhum'} (a Meta passou a aceitar mais valores)`),
    };
  });

  await run('erro 401 (chave inválida)', async () => {
    const invalid = new MetaModelProvider({ ...connection, apiKey: 'chave-invalida' });
    try {
      await invalid.complete({
        model,
        system: [],
        messages: userText('Verificação.'),
        tools: [],
        maxOutputTokens: 64,
      });
      return { status: 'fail', detail: 'chave inválida foi aceita' };
    } catch (error) {
      const ok = error instanceof AIProviderError && !error.retryable && statusOf(error) === 401;
      return {
        status: ok ? 'ok' : 'fail',
        detail: `${describeError(error)}; retryable=${error instanceof AIProviderError ? error.retryable : '?'}`,
      };
    }
  });

  await run('erro 400/404 (modelo inexistente)', async () => {
    try {
      await provider.complete({
        model: 'modelo-inexistente',
        system: [],
        messages: userText('Verificação.'),
        tools: [],
        maxOutputTokens: 64,
      });
      return { status: 'fail', detail: 'modelo inexistente foi aceito' };
    } catch (error) {
      const status = statusOf(error);
      // 400 é definitivo; 404 é tratado como instabilidade (a Meta devolve 404 intermitente
      // para modelos válidos), então o provider repete e marca como retryable.
      const ok =
        error instanceof AIProviderError &&
        ((status === 400 && !error.retryable) || (status === 404 && error.retryable));
      return {
        status: ok ? 'ok' : 'fail',
        detail: `${describeError(error)}; retryable=${error instanceof AIProviderError ? error.retryable : '?'}`,
      };
    }
  });

  checks.push({
    name: 'erros 429/5xx',
    status: 'skipped',
    detail: 'não provocáveis com segurança na API real; cobertos pelos testes automáticos',
  });

  return {
    checks,
    usage,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1e6) / 1e6,
    passed: checks.every((check) => check.status !== 'fail'),
  };
}
