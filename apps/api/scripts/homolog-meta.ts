/**
 * Homologação da Meta Model API (Muse Spark) com as variáveis de IA do ambiente.
 * Faz poucas chamadas pequenas e PAGAS; não acessa banco, Redis nem WhatsApp.
 *
 *   pnpm homolog:meta   # modelo, conversa, raciocínio, tools, limite, streaming, tool_choice e erros
 */
import { envSchema, isModelCompatible } from '@botsaas/config';
import { runMetaHomologation } from '@botsaas/ai';

const aiEnv = envSchema.pick({
  META_MODEL_API_KEY: true,
  META_MODEL_API_BASE_URL: true,
  AI_DEFAULT_MODEL: true,
  AI_SUMMARY_MODEL: true,
  AI_REQUEST_TIMEOUT_MS: true,
});

const env = aiEnv.parse(
  Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  ),
);

if (!env.META_MODEL_API_KEY) {
  process.stderr.write('META_MODEL_API_KEY ausente: configure-a no ambiente ou no .env.\n');
  process.exit(1);
}

const configured = [env.AI_DEFAULT_MODEL, env.AI_SUMMARY_MODEL].filter((model): model is string =>
  Boolean(model),
);
const models = [...new Set(configured.filter((model) => isModelCompatible('meta', model)))];
for (const model of configured.filter((model) => !isModelCompatible('meta', model))) {
  process.stdout.write(`PULADO ${model}: não é um modelo da Meta (ajuste AI_DEFAULT_MODEL)\n`);
}
if (models.length === 0) models.push('muse-spark-1.3');

const report = await runMetaHomologation({
  apiKey: env.META_MODEL_API_KEY,
  baseURL: env.META_MODEL_API_BASE_URL,
  models,
  timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
});

const icon = { ok: 'OK  ', warn: 'AVISO', fail: 'FALHA', skipped: 'PULADO' } as const;
for (const check of report.checks) {
  process.stdout.write(`${icon[check.status].padEnd(6)} ${check.name}: ${check.detail}\n`);
}
process.stdout.write(
  `\nConsumo: ${report.usage.inputTokens} in / ${report.usage.outputTokens} out / ` +
    `${report.usage.cacheReadTokens} cache read` +
    ` — custo estimado US$ ${report.estimatedCostUsd.toFixed(4)}\n` +
    `Resultado: ${report.passed ? 'APROVADO' : 'REPROVADO'}\n`,
);
process.exit(report.passed ? 0 : 1);
