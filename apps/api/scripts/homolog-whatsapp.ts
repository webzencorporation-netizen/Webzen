/**
 * Homologação da WhatsApp Cloud API com o token de UM número (System User da Meta).
 * Somente leitura, exceto com --send-to, que envia UM template aprovado ao número informado.
 * Não acessa banco nem Redis e não imprime o token.
 *
 *   HOMOLOG_WA_ACCESS_TOKEN=... HOMOLOG_WA_PHONE_NUMBER_ID=... HOMOLOG_WA_WABA_ID=... \
 *     pnpm homolog:whatsapp [--send-to=5511999999999] [--template=hello_world] [--lang=en_US]
 */
import { envSchema } from '@botsaas/config';
import { runWhatsAppHomologation } from '@botsaas/whatsapp';
import { z } from 'zod';

const cleaned = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
);
const env = envSchema
  .pick({
    API_PUBLIC_URL: true,
    WHATSAPP_GRAPH_API_BASE_URL: true,
    WHATSAPP_GRAPH_API_VERSION: true,
    WHATSAPP_APP_SECRET: true,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: true,
  })
  .extend({
    HOMOLOG_WA_ACCESS_TOKEN: z.string({ error: 'obrigatória (token de System User da Meta)' }),
    HOMOLOG_WA_PHONE_NUMBER_ID: z.string({
      error: 'obrigatória (Phone number ID do WhatsApp Manager)',
    }),
    HOMOLOG_WA_WABA_ID: z.string().optional(),
  })
  .safeParse(cleaned);

if (!env.success) {
  for (const issue of env.error.issues)
    process.stderr.write(`${issue.path.join('.')}: ${issue.message}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const report = await runWhatsAppHomologation({
  accessToken: env.data.HOMOLOG_WA_ACCESS_TOKEN,
  phoneNumberId: env.data.HOMOLOG_WA_PHONE_NUMBER_ID,
  wabaId: env.data.HOMOLOG_WA_WABA_ID,
  baseUrl: env.data.WHATSAPP_GRAPH_API_BASE_URL,
  apiVersion: env.data.WHATSAPP_GRAPH_API_VERSION,
  webhook: {
    publicUrl: env.data.API_PUBLIC_URL,
    appSecretSet: Boolean(env.data.WHATSAPP_APP_SECRET),
    verifyTokenSet: Boolean(env.data.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
  },
  sendTo: arg('send-to'),
  template: { name: arg('template') ?? 'hello_world', languageCode: arg('lang') ?? 'en_US' },
});

const label = { ok: 'OK', warn: 'AVISO', fail: 'FALHA', skipped: 'PULADO' } as const;
for (const check of report.checks) {
  process.stdout.write(`${label[check.status].padEnd(6)} ${check.name}: ${check.detail}\n`);
}
process.stdout.write(`\nResultado: ${report.passed ? 'APROVADO' : 'REPROVADO'}\n`);
process.exit(report.passed ? 0 : 1);
