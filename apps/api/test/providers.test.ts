import { envSchema, type Env } from '@botsaas/config';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/lib/logger';
import { createProviders } from '../src/providers';

/**
 * Segunda barreira além de `validateEnvRules`: mesmo com um env montado sem a validação
 * cruzada, a composição dos providers nunca troca silenciosamente um provider real
 * por simulação e nunca aceita simulação em produção.
 */

const logger = createLogger('silent');

function env(values: Record<string, string>): Env {
  // `envSchema.parse` aplica só o schema, sem as regras cruzadas de parseEnv.
  return envSchema.parse({ DATABASE_URL: 'postgresql://localhost/unused', ...values });
}

describe('createProviders', () => {
  it('desenvolvimento sem credenciais usa simulações explícitas', () => {
    const providers = createProviders(env({}), logger);
    expect(providers.ai.name).toBe('mock');
    expect(providers.messaging.name).toBe('mock');
    expect(providers.storage.name).toBe('local');
    expect(providers.speechToText.name).toBe('none');
  });

  it('usa os providers reais quando configurados', () => {
    const providers = createProviders(
      env({
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'placeholder-not-real',
        WHATSAPP_PROVIDER: 'cloud',
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'bucket',
        S3_REGION: 'auto',
        STT_PROVIDER: 'openai-compatible',
        STT_API_URL: 'https://stt.example.com/v1/audio/transcriptions',
        STT_API_KEY: 'placeholder-not-real',
      }),
      logger,
    );
    expect(providers.ai.name).toBe('anthropic');
    expect(providers.messaging.name).toBe('cloud');
    expect(providers.storage.name).toBe('s3');
    expect(providers.speechToText.name).toBe('openai-compatible');
  });

  it('Meta Model API vira um provider próprio, separado do da Anthropic', () => {
    const providers = createProviders(
      env({
        AI_PROVIDER: 'meta',
        META_MODEL_API_KEY: 'placeholder-not-real',
        AI_DEFAULT_MODEL: 'muse-spark-1.3',
      }),
      logger,
    );
    expect(providers.ai.name).toBe('meta');
  });

  it.each([
    [{ AI_PROVIDER: 'anthropic' }, /ANTHROPIC_API_KEY/],
    [{ AI_PROVIDER: 'meta' }, /META_MODEL_API_KEY/],
    [{ STORAGE_PROVIDER: 's3' }, /S3_BUCKET/],
    [{ STT_PROVIDER: 'openai-compatible', STT_API_KEY: 'x' }, /STT_API_URL/],
    [{ EMAIL_PROVIDER: 'smtp' }, /SMTP_HOST/],
  ])('provider real incompleto falha em vez de cair na simulação: %o', (values, message) => {
    expect(() => createProviders(env(values), logger)).toThrow(message);
  });

  it.each<Record<string, string>>([
    { AI_PROVIDER: 'mock' },
    { WHATSAPP_PROVIDER: 'mock' },
    { STT_PROVIDER: 'mock' },
    { STORAGE_PROVIDER: 'local' },
    { EMAIL_PROVIDER: 'log' },
  ])('produção recusa simulação mesmo sem a validação do env: %o', (override) => {
    const production = {
      NODE_ENV: 'production',
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'placeholder-not-real',
      WHATSAPP_PROVIDER: 'cloud',
      STORAGE_PROVIDER: 's3',
      S3_BUCKET: 'bucket',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.test',
    };
    expect(() => createProviders(env(production), logger)).not.toThrow();
    expect(() => createProviders(env({ ...production, ...override }), logger)).toThrow(/produção/);
  });
});
