import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeProviders,
  EnvValidationError,
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
});
