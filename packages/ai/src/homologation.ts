import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AgentEngine } from './engine';
import { DEFAULT_MODEL_PRICING, estimateCostUsd } from './pricing';
import { AnthropicProvider } from './provider/anthropic';
import { addUsage, emptyUsage, type AIUsage } from './provider/types';

/**
 * Homologação do provider real da Anthropic: poucas chamadas pequenas, pagas, que
 * exercitam o mesmo caminho do atendimento (AnthropicProvider + AgentEngine + tools).
 * Nunca registra a chave; o relatório contém somente status, modelos e consumo.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface HomologationCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface HomologationOptions {
  apiKey: string;
  /** Modelos configurados (padrão e resumo), sem repetição. */
  models: string[];
  refusalFallback: boolean;
  timeoutMs?: number;
  baseURL?: string;
  /** Duas chamadas com prefixo estável longo (~6 mil tokens) para confirmar cache. */
  checkCache?: boolean;
}

export interface HomologationReport {
  checks: HomologationCheck[];
  usage: AIUsage;
  /** Estimativa pela tabela padrão; tentativas recusadas antes de fallback não entram. */
  estimatedCostUsd: number;
  passed: boolean;
}

const HOMOLOGATION_CODE = 'HML-7Q4Z';

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `HTTP ${error.status ?? '?'}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Texto estável e longo o bastante para superar o prefixo mínimo cacheável dos modelos atuais. */
function cacheablePrefix(): string {
  const rule =
    'Regra de homologação: responda somente ao que foi perguntado, em português, sem inventar dados.';
  return Array.from({ length: 400 }, (_, index) => `${index + 1}. ${rule}`).join('\n');
}

export async function runAnthropicHomologation(
  options: HomologationOptions,
): Promise<HomologationReport> {
  const checks: HomologationCheck[] = [];
  let usage = emptyUsage();
  let estimatedCostUsd = 0;
  const account = (model: string, delta: AIUsage) => {
    usage = addUsage(usage, delta);
    estimatedCostUsd += estimateCostUsd(delta, DEFAULT_MODEL_PRICING[model]);
  };

  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 1,
    timeout: options.timeoutMs ?? 120_000,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
  const provider = new AnthropicProvider({
    apiKey: options.apiKey,
    maxRetries: 1,
    timeoutMs: options.timeoutMs ?? 120_000,
    refusalFallback: options.refusalFallback,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });

  const available: string[] = [];
  for (const model of options.models) {
    try {
      const info = await client.models.retrieve(model);
      available.push(model);
      checks.push({
        name: `modelo ${model}`,
        status: 'ok',
        detail: `disponível (${info.display_name})`,
      });
    } catch (error) {
      checks.push({ name: `modelo ${model}`, status: 'fail', detail: describeError(error) });
    }
    checks.push(
      DEFAULT_MODEL_PRICING[model]
        ? { name: `preço ${model}`, status: 'ok', detail: 'presente na tabela padrão' }
        : {
            name: `preço ${model}`,
            status: 'warn',
            detail: 'ausente da tabela padrão: custo estimado será zero até cadastrar o preço',
          },
    );
  }

  const model = available[0];
  if (!model) {
    const skipped = ['resposta simples', 'tool use', 'prompt caching'];
    for (const name of skipped)
      checks.push({ name, status: 'skipped', detail: 'nenhum modelo configurado disponível' });
    return { checks, usage, estimatedCostUsd, passed: false };
  }

  try {
    const response = await provider.complete({
      model,
      system: [{ text: 'Você está em uma verificação técnica. Responda apenas "OK".' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Verificação.' }] }],
      tools: [],
      maxOutputTokens: 2048,
      effort: 'low',
    });
    for (const attempt of response.attempts) account(attempt.model, attempt.usage);
    const served = response.attempts.find((attempt) => attempt.served);
    const ok = response.stopReason === 'end_turn' && response.text.length > 0;
    checks.push({
      name: 'resposta simples',
      status: ok ? 'ok' : 'fail',
      detail: ok
        ? `${response.model}${served?.fallback ? ' (fallback)' : ''}; ${response.usage.inputTokens} in / ${response.usage.outputTokens} out`
        : `stop_reason=${response.stopReason}${response.refusal ? ` categoria=${response.refusal.category ?? 'nula'}` : ''}`,
    });
  } catch (error) {
    checks.push({ name: 'resposta simples', status: 'fail', detail: describeError(error) });
  }

  try {
    let toolCalls = 0;
    const result = await AgentEngine.run({
      provider,
      model,
      system: [
        {
          text: 'Você está em uma verificação técnica. Use a ferramenta disponível para obter o código e responda somente com ele.',
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Qual é o código?' }] }],
      tools: [
        {
          name: 'get_homologation_code',
          description: 'Retorna o código da verificação técnica.',
          inputSchema: z.object({}),
          mutating: false,
          handler: async () => {
            toolCalls += 1;
            return { ok: true, data: { code: HOMOLOGATION_CODE } };
          },
        },
      ],
      toolContext: {},
      maxIterations: 3,
      maxOutputTokens: 2048,
      effort: 'low',
      meta: { dryRun: true },
    });
    for (const attempt of result.attempts) account(attempt.model, attempt.usage);
    const ok =
      result.outcome === 'answered' && toolCalls >= 1 && result.text.includes(HOMOLOGATION_CODE);
    checks.push({
      name: 'tool use',
      status: ok ? 'ok' : 'fail',
      detail: `outcome=${result.outcome}; tools=${toolCalls}; iterações=${result.iterations}; modelos=${result.modelsUsed.join(',')}`,
    });
  } catch (error) {
    checks.push({ name: 'tool use', status: 'fail', detail: describeError(error) });
  }

  if (!options.checkCache) {
    checks.push({
      name: 'prompt caching',
      status: 'skipped',
      detail: 'use --cache para verificar',
    });
  } else {
    try {
      const prefix = cacheablePrefix();
      const reads: number[] = [];
      for (const question of ['Primeira verificação.', 'Segunda verificação.']) {
        const response = await provider.complete({
          model,
          system: [{ text: prefix, cacheBreakpoint: true }, { text: 'Responda apenas "OK".' }],
          messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
          tools: [],
          maxOutputTokens: 1024,
          effort: 'low',
        });
        for (const attempt of response.attempts) account(attempt.model, attempt.usage);
        reads.push(response.usage.cacheReadTokens);
      }
      checks.push({
        name: 'prompt caching',
        status: (reads[1] ?? 0) > 0 ? 'ok' : 'warn',
        detail: `cache_read na segunda chamada: ${reads[1] ?? 0} tokens`,
      });
    } catch (error) {
      checks.push({ name: 'prompt caching', status: 'fail', detail: describeError(error) });
    }
  }

  return {
    checks,
    usage,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1e6) / 1e6,
    passed: checks.every((check) => check.status !== 'fail'),
  };
}
