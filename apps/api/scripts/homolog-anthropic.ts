/**
 * Homologação do provider real da Anthropic com as variáveis de IA do ambiente.
 * Faz poucas chamadas pequenas e PAGAS; não acessa banco, Redis nem WhatsApp.
 *
 *   pnpm homolog:anthropic            # modelos, resposta simples e tool use
 *   pnpm homolog:anthropic --cache    # também confirma prompt caching (~12 mil tokens de entrada)
 */
import { envSchema } from '@botsaas/config';
import { runAnthropicHomologation } from '@botsaas/ai';

const aiEnv = envSchema.pick({
  ANTHROPIC_API_KEY: true,
  AI_DEFAULT_MODEL: true,
  AI_SUMMARY_MODEL: true,
  AI_REFUSAL_FALLBACK: true,
  AI_REQUEST_TIMEOUT_MS: true,
});

const env = aiEnv.parse(
  Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  ),
);

if (!env.ANTHROPIC_API_KEY) {
  process.stderr.write('ANTHROPIC_API_KEY ausente: configure-a no ambiente ou no .env.\n');
  process.exit(1);
}

const models = [...new Set([env.AI_DEFAULT_MODEL, env.AI_SUMMARY_MODEL].filter(Boolean))];
const report = await runAnthropicHomologation({
  apiKey: env.ANTHROPIC_API_KEY,
  models: models as string[],
  refusalFallback: env.AI_REFUSAL_FALLBACK,
  timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
  checkCache: process.argv.includes('--cache'),
});

const icon = { ok: 'OK  ', warn: 'AVISO', fail: 'FALHA', skipped: 'PULADO' } as const;
for (const check of report.checks) {
  process.stdout.write(`${icon[check.status].padEnd(6)} ${check.name}: ${check.detail}\n`);
}
process.stdout.write(
  `\nConsumo: ${report.usage.inputTokens} in / ${report.usage.outputTokens} out / ` +
    `${report.usage.cacheReadTokens} cache read / ${report.usage.cacheWriteTokens} cache write` +
    ` — custo estimado US$ ${report.estimatedCostUsd.toFixed(4)}\n` +
    `Resultado: ${report.passed ? 'APROVADO' : 'REPROVADO'}\n`,
);
process.exit(report.passed ? 0 : 1);
