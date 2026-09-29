import { z } from 'zod';

/**
 * Variáveis de ambiente da plataforma. Documentação de cada variável em `.env.example`.
 * Nenhum segredo possui valor padrão.
 */

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // URLs e rede
  APP_URL: z.url().default('http://localhost:3000'),
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),

  // Infra
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // Segurança
  ENCRYPTION_KEY: optionalString,
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: booleanString.optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  // IA
  AI_PROVIDER: z.enum(['anthropic', 'meta', 'mock']).default('mock'),
  ANTHROPIC_API_KEY: optionalString,
  META_MODEL_API_KEY: optionalString,
  META_MODEL_API_BASE_URL: z.url().default('https://api.meta.ai'),
  AI_DEFAULT_MODEL: z.string().min(1).default('claude-opus-5'),
  AI_SUMMARY_MODEL: optionalString,
  AI_REFUSAL_FALLBACK: booleanString.default(true),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // WhatsApp (Meta Cloud API)
  WHATSAPP_PROVIDER: z.enum(['cloud', 'mock']).default('mock'),
  WHATSAPP_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Formato esperado: v25.0')
    .default('v25.0'),
  WHATSAPP_GRAPH_API_BASE_URL: z.url().default('https://graph.facebook.com'),
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalString,
  META_APP_ID: optionalString,
  META_EMBEDDED_SIGNUP_CONFIG_ID: optionalString,

  // Armazenamento de objetos
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_BUCKET: optionalString,
  S3_REGION: optionalString,
  S3_ENDPOINT: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(16 * 1024 * 1024),

  // Transcrição de áudio
  STT_PROVIDER: z.enum(['none', 'mock', 'openai-compatible']).default('none'),
  STT_API_URL: optionalString,
  STT_API_KEY: optionalString,
  STT_MODEL: optionalString,

  // Google Calendar
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,

  // Seed
  SEED_ADMIN_EMAIL: z.email().default('admin@plataforma.local'),
  SEED_ADMIN_PASSWORD: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export type AIProviderName = Env['AI_PROVIDER'];

/** Provedor de IA dono de um id de modelo (pelo prefixo); `null` quando desconhecido. */
export function aiProviderForModel(model: string): Exclude<AIProviderName, 'mock'> | null {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('muse-')) return 'meta';
  return null;
}

/**
 * Um modelo serve ao provedor ativo quando pertence a ele ou tem prefixo desconhecido.
 * O mock aceita qualquer modelo (não chama API).
 */
export function isModelCompatible(provider: AIProviderName, model: string): boolean {
  if (provider === 'mock') return true;
  const owner = aiProviderForModel(model);
  return owner === null || owner === provider;
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração de ambiente inválida:\n - ${issues.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Regras cruzadas: o que é obrigatório depende dos providers escolhidos. */
export function validateEnvRules(env: Env): string[] {
  const issues: string[] = [];
  const isProd = env.NODE_ENV === 'production';

  if (isProd) {
    if (env.AI_PROVIDER === 'mock') issues.push('AI_PROVIDER=mock não é permitido em produção.');
    if (env.WHATSAPP_PROVIDER === 'mock')
      issues.push('WHATSAPP_PROVIDER=mock não é permitido em produção.');
    if (env.STT_PROVIDER === 'mock') issues.push('STT_PROVIDER=mock não é permitido em produção.');
    if (env.STORAGE_PROVIDER === 'local')
      issues.push('STORAGE_PROVIDER=local não é recomendado em produção; use s3 (S3/R2).');
    if (!env.ENCRYPTION_KEY) issues.push('ENCRYPTION_KEY é obrigatória em produção.');
  }

  if (env.ENCRYPTION_KEY && Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32) {
    issues.push(
      'ENCRYPTION_KEY deve ter 32 bytes codificados em base64 (openssl rand -base64 32).',
    );
  }
  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    issues.push('ANTHROPIC_API_KEY é obrigatória quando AI_PROVIDER=anthropic.');
  }
  if (env.AI_PROVIDER === 'meta' && !env.META_MODEL_API_KEY) {
    issues.push('META_MODEL_API_KEY é obrigatória quando AI_PROVIDER=meta.');
  }
  for (const [variable, model] of [
    ['AI_DEFAULT_MODEL', env.AI_DEFAULT_MODEL],
    ['AI_SUMMARY_MODEL', env.AI_SUMMARY_MODEL],
  ] as const) {
    if (model && !isModelCompatible(env.AI_PROVIDER, model)) {
      issues.push(
        `${variable}=${model} pertence a outro provedor; com AI_PROVIDER=${env.AI_PROVIDER} use um modelo desse provedor` +
          (env.AI_PROVIDER === 'meta' ? ' (ex.: muse-spark-1.3).' : '.'),
      );
    }
  }
  if (env.WHATSAPP_PROVIDER === 'cloud') {
    if (!env.WHATSAPP_APP_SECRET)
      issues.push('WHATSAPP_APP_SECRET é obrigatória quando WHATSAPP_PROVIDER=cloud.');
    if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
      issues.push('WHATSAPP_WEBHOOK_VERIFY_TOKEN é obrigatória quando WHATSAPP_PROVIDER=cloud.');
  }
  if (env.STORAGE_PROVIDER === 's3' && !env.S3_BUCKET) {
    issues.push('S3_BUCKET é obrigatória quando STORAGE_PROVIDER=s3.');
  }
  if (env.STT_PROVIDER === 'openai-compatible' && (!env.STT_API_URL || !env.STT_API_KEY)) {
    issues.push(
      'STT_API_URL e STT_API_KEY são obrigatórias quando STT_PROVIDER=openai-compatible.',
    );
  }
  return issues;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Variáveis vazias (ex.: `COOKIE_SECURE=` no .env) contam como não definidas.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const issues = validateEnvRules(parsed.data);
  if (issues.length > 0) throw new EnvValidationError(issues);
  return parsed.data;
}

let cachedEnv: Env | undefined;

/** Env validado e memoizado para o processo. */
export function getEnv(): Env {
  cachedEnv ??= parseEnv();
  return cachedEnv;
}

/** Apenas para testes. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}

export function isProduction(env: Env = getEnv()): boolean {
  return env.NODE_ENV === 'production';
}

/** Resumo seguro (sem segredos) dos providers ativos — exibido no painel da plataforma. */
export function describeProviders(env: Env = getEnv()) {
  return {
    ai: env.AI_PROVIDER,
    aiDefaultModel: env.AI_DEFAULT_MODEL,
    whatsapp: env.WHATSAPP_PROVIDER,
    whatsappGraphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
    storage: env.STORAGE_PROVIDER,
    speechToText: env.STT_PROVIDER,
    googleCalendar: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}
