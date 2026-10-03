import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiProviderForModel,
  describeProviders,
  EnvValidationError,
  isModelCompatible,
  envSchema,
  getEnv,
  parseEnv,
  resetEnvCache,
} from '../src/env';

// Cada chamada usa um objeto próprio; nenhuma credencial do shell é necessária.
const local: NodeJS.ProcessEnv = { DATABASE_URL: 'postgresql://test:test@localhost/config_test' };
const production: NodeJS.ProcessEnv = {
  ...local,
  NODE_ENV: 'production',
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'fixture-anthropic-key',
  WHATSAPP_PROVIDER: 'cloud',
  WHATSAPP_APP_SECRET: 'fixture-meta-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fixture-verify-token',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'fixture-bucket',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'WebZen <nao-responda@webzen.example>',
  SMTP_HOST: 'smtp.example.test',
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('configuração de ambiente', () => {
  it('permite desenvolvimento com providers locais sem segredos externos', () => {
    const env = parseEnv(local);
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.WHATSAPP_PROVIDER).toBe('mock');
    expect(env.STORAGE_PROVIDER).toBe('local');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.WHATSAPP_APP_SECRET).toBeUndefined();
  });

  it('exige banco mesmo em desenvolvimento', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    expect(() => parseEnv({ DATABASE_URL: ' ' })).toThrow(/DATABASE_URL/);
  });

  it('trata variáveis vazias como ausentes antes de aplicar os padrões', () => {
    const env = parseEnv({ ...local, AI_PROVIDER: '', COOKIE_SECURE: ' ', AI_SUMMARY_MODEL: '' });
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.COOKIE_SECURE).toBeUndefined();
    expect(env.AI_SUMMARY_MODEL).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('interpreta booleano %s sem tratar a string false como verdadeira', (value, expected) => {
    expect(parseEnv({ ...local, COOKIE_SECURE: value }).COOKIE_SECURE).toBe(expected);
  });

  it('recusa booleanos e números inválidos em vez de seguir com valor ambíguo', () => {
    expect(() => parseEnv({ ...local, COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
    expect(() => parseEnv({ ...local, AI_REQUEST_TIMEOUT_MS: '0' })).toThrow(
      /AI_REQUEST_TIMEOUT_MS/,
    );
  });

  it('aceita produção com providers reais configurados e STT desativado', () => {
    expect(parseEnv(production).STT_PROVIDER).toBe('none');
  });

  it.each([
    ['AI_PROVIDER', 'mock'],
    ['WHATSAPP_PROVIDER', 'mock'],
    ['STT_PROVIDER', 'mock'],
    ['STORAGE_PROVIDER', 'local'],
    ['ENCRYPTION_KEY', undefined],
    ['EMAIL_PROVIDER', 'log'],
    ['BILLING_PROVIDER', 'mock'],
    ['EMAIL_FROM', 'WebZen <nao-responda@webzen.local>'],
  ])('recusa configuração insegura de produção: %s=%s', (name, value) => {
    expect(() => parseEnv({ ...production, [name]: value })).toThrow(name);
  });

  it.each([31, 33])('recusa chave de criptografia de %i bytes mesmo fora de produção', (bytes) => {
    expect(() =>
      parseEnv({ ...local, ENCRYPTION_KEY: Buffer.alloc(bytes).toString('base64') }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it.each([
    ['ANTHROPIC_API_KEY'],
    ['WHATSAPP_APP_SECRET'],
    ['WHATSAPP_WEBHOOK_VERIFY_TOKEN'],
    ['S3_BUCKET'],
    ['SMTP_HOST'],
  ])('exige %s quando seu provider real está selecionado', (name) => {
    expect(() => parseEnv({ ...production, NODE_ENV: 'development', [name]: undefined })).toThrow(
      name,
    );
  });

  it.each(['STT_API_URL', 'STT_API_KEY'])('exige %s para transcrição compatível', (name) => {
    expect(() =>
      parseEnv({
        ...local,
        STT_PROVIDER: 'openai-compatible',
        STT_API_URL: 'https://stt.example.invalid/audio/transcriptions',
        STT_API_KEY: 'fixture-stt-key',
        [name]: undefined,
      }),
    ).toThrow(name);
  });

  it('aceita transcrição configurada e versão Graph explícita', () => {
    const env = parseEnv({
      ...local,
      STT_PROVIDER: 'openai-compatible',
      STT_API_URL: 'https://stt.example.invalid/audio/transcriptions',
      STT_API_KEY: 'fixture-stt-key',
      WHATSAPP_GRAPH_API_VERSION: 'v25.0',
    });
    expect(env.STT_PROVIDER).toBe('openai-compatible');
    expect(env.WHATSAPP_GRAPH_API_VERSION).toBe('v25.0');
    expect(() => parseEnv({ ...local, WHATSAPP_GRAPH_API_VERSION: 'latest' })).toThrow(
      /WHATSAPP_GRAPH_API_VERSION/,
    );
  });

  it('resume providers sem expor credenciais ou URLs de infraestrutura', () => {
    const env = parseEnv({
      ...production,
      GOOGLE_CLIENT_ID: 'fixture-google-client',
      GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
      S3_ACCESS_KEY_ID: 'fixture-s3-id',
      S3_SECRET_ACCESS_KEY: 'fixture-s3-secret',
    });
    const summary = describeProviders(env);
    expect(summary).toMatchObject({
      ai: 'anthropic',
      whatsapp: 'cloud',
      storage: 's3',
      googleCalendar: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('fixture-');
    expect(serialized).not.toContain('postgresql:');
    expect(serialized).not.toContain(production.ENCRYPTION_KEY);
  });

  it('Meta Model API: exige a chave e um modelo da Meta, sem vazar a chave no resumo', () => {
    const meta = {
      ...production,
      AI_PROVIDER: 'meta',
      ANTHROPIC_API_KEY: '',
      META_MODEL_API_KEY: 'fixture-meta-model-key',
      AI_DEFAULT_MODEL: 'muse-spark-1.3',
    };
    const env = parseEnv(meta);
    expect(env.META_MODEL_API_BASE_URL).toBe('https://api.meta.ai');
    expect(describeProviders(env)).toMatchObject({ ai: 'meta', aiDefaultModel: 'muse-spark-1.3' });
    expect(JSON.stringify(describeProviders(env))).not.toContain('fixture-');

    expect(() => parseEnv({ ...meta, META_MODEL_API_KEY: '' })).toThrow(/META_MODEL_API_KEY/);
    expect(() => parseEnv({ ...meta, AI_DEFAULT_MODEL: 'claude-opus-5' })).toThrow(
      /AI_DEFAULT_MODEL=claude-opus-5 pertence a outro provedor.*muse-spark-1\.3/,
    );
    expect(() => parseEnv({ ...meta, AI_SUMMARY_MODEL: 'claude-haiku-4-5' })).toThrow(
      /AI_SUMMARY_MODEL/,
    );
  });

  it('Anthropic recusa modelo da Meta; mock aceita qualquer modelo', () => {
    expect(() => parseEnv({ ...production, AI_DEFAULT_MODEL: 'muse-spark-1.3' })).toThrow(
      /AI_DEFAULT_MODEL=muse-spark-1.3 pertence a outro provedor/,
    );
    expect(parseEnv({ ...local, AI_DEFAULT_MODEL: 'muse-spark-1.3' }).AI_PROVIDER).toBe('mock');
  });

  it('TRUST_PROXY: desligado por padrão, aceita saltos ou IPs e recusa confiar em todos', () => {
    expect(parseEnv(local).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...local, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(parseEnv({ ...local, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).TRUST_PROXY).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    expect(() => parseEnv({ ...local, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('lê a tabela de preços do WhatsApp e recusa formato inválido', () => {
    expect(
      parseEnv({ ...local, WHATSAPP_PRICE_USD: '{"marketing":0.0625}' }).WHATSAPP_PRICE_USD,
    ).toEqual({
      marketing: 0.0625,
    });
    expect(parseEnv(local).WHATSAPP_PRICE_USD).toBeUndefined();
    for (const invalid of ['0.0068', '{"service":-1}', '{"service":"barato"}', 'não é json']) {
      expect(() => parseEnv({ ...local, WHATSAPP_PRICE_USD: invalid })).toThrow(
        /WHATSAPP_PRICE_USD/,
      );
    }
  });

  it('identifica o provedor dono de cada modelo pelo prefixo', () => {
    expect(aiProviderForModel('claude-opus-5')).toBe('anthropic');
    expect(aiProviderForModel('muse-spark-1.3')).toBe('meta');
    expect(aiProviderForModel('modelo-proprio')).toBeNull();
    expect(isModelCompatible('meta', 'muse-spark-1.3')).toBe(true);
    expect(isModelCompatible('meta', 'claude-opus-5')).toBe(false);
    expect(isModelCompatible('anthropic', 'muse-spark-1.3')).toBe(false);
    expect(isModelCompatible('meta', 'modelo-proprio')).toBe(true);
    expect(isModelCompatible('mock', 'claude-opus-5')).toBe(true);
  });

  it('só sinaliza credenciais Google quando ambos os campos estão presentes', () => {
    expect(
      describeProviders(parseEnv({ ...local, GOOGLE_CLIENT_ID: 'fixture-client' })).googleCalendar,
    ).toBe(false);
  });

  it('mantém o ambiente memoizado até o reset explícito', () => {
    for (const name of Object.keys(envSchema.shape)) vi.stubEnv(name, undefined);
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/config_test');
    vi.stubEnv('AI_DEFAULT_MODEL', 'fixture-model-a');
    resetEnvCache();
    expect(getEnv().AI_DEFAULT_MODEL).toBe('fixture-model-a');
    vi.stubEnv('AI_DEFAULT_MODEL', 'fixture-model-b');
    expect(getEnv().AI_DEFAULT_MODEL).toBe('fixture-model-a');
    resetEnvCache();
    expect(getEnv().AI_DEFAULT_MODEL).toBe('fixture-model-b');
  });

  it('Stripe exige chave secreta e segredo do webhook com o formato oficial', () => {
    const stripe = { ...local, BILLING_PROVIDER: 'stripe' };
    expect(() => parseEnv(stripe)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      parseEnv({ ...stripe, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'segredo' }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(
      parseEnv({ ...stripe, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })
        .BILLING_PROVIDER,
    ).toBe('stripe');
  });

  it('SMTP com usuário exige a senha (e vice-versa)', () => {
    expect(() =>
      parseEnv({ ...local, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test', SMTP_USER: 'u' }),
    ).toThrow(/SMTP_PASSWORD/);
  });
});

describe('.env.example', () => {
  it('documenta toda variável aceita pela aplicação (sem valores reais)', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const example = await readFile(
      path.resolve(import.meta.dirname, '../../../.env.example'),
      'utf8',
    );
    const documented = new Set(
      [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]),
    );
    const missing = Object.keys(envSchema.shape).filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
    // Segredos nunca têm valor no exemplo.
    for (const secret of [
      'ANTHROPIC_API_KEY',
      'META_MODEL_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'SMTP_PASSWORD',
      'ENCRYPTION_KEY',
    ]) {
      expect(example).toMatch(new RegExp(`^${secret}=\\s*$`, 'm'));
    }
  });
});
