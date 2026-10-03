import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://botsaas:botsaas@localhost:5432/botsaas_test';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  APP_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:4000',
  AI_PROVIDER: 'mock',
  // Independente do .env de quem roda: modelo fixo e nenhuma chave real (APIs pagas).
  AI_DEFAULT_MODEL: 'claude-opus-5',
  AI_SUMMARY_MODEL: '',
  ANTHROPIC_API_KEY: '',
  META_MODEL_API_KEY: '',
  WHATSAPP_PROVIDER: 'mock',
  WHATSAPP_APP_SECRET: 'test-app-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
  STORAGE_PROVIDER: 'local',
  STORAGE_LOCAL_DIR: path.resolve(import.meta.dirname, '../../../../.local/test-storage'),
  STT_PROVIDER: 'mock',
  RATE_LIMIT_PER_MINUTE: '10000',
  LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
  LOGIN_ACCOUNT_MAX_ATTEMPTS: '1000',
  AI_TEST_RATE_LIMIT_PER_MINUTE: '1000',
  ACCOUNT_EMAIL_RATE_LIMIT_PER_HOUR: '1000',
  SIGNUP_ENABLED: 'true',
  SESSION_IDLE_TIMEOUT_HOURS: '72',
  // E-mails ficam no MemoryEmailSender do harness; nada de SMTP real nos testes.
  EMAIL_PROVIDER: 'log',
  EMAIL_LOG_DIR: path.resolve(import.meta.dirname, '../../../../.local/test-mail'),
  BILLING_PROVIDER: 'none',
  BILLING_TRIAL_DAYS: '0',
};
