import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_E2E_DATABASE_URL, resolveE2eDatabaseTarget } from './e2e/database-target';

/**
 * E2E dos fluxos críticos contra uma pilha isolada:
 * banco `botsaas_e2e` (preparado antes da API), API :4100, worker e painel :3100,
 * com providers simulados (IA e WhatsApp). Requer Postgres e Redis locais
 * (docker compose up -d ou pnpm services:local).
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
// Valida antes de iniciar processos, inclusive durante --list (sem conectar).
const E2E_DATABASE_URL = resolveE2eDatabaseTarget(
  process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL,
).connectionString;
const API_PORT = process.env.E2E_API_PORT ?? '4100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3100';
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const serverEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: E2E_DATABASE_URL,
  E2E_DATABASE_URL,
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/5',
  API_PORT,
  API_PUBLIC_URL: API_URL,
  APP_URL: WEB_URL,
  AI_PROVIDER: 'mock',
  WHATSAPP_PROVIDER: 'mock',
  WHATSAPP_APP_SECRET: 'e2e-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'e2e-verify',
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  STORAGE_PROVIDER: 'local',
  STORAGE_LOCAL_DIR: path.join(ROOT, '.local/e2e-storage'),
  STT_PROVIDER: 'mock',
  RATE_LIMIT_PER_MINUTE: '5000',
  LOGIN_RATE_LIMIT_PER_MINUTE: '500',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: WEB_URL, trace: 'retain-on-failure', locale: 'pt-BR' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    // Node direto mantém os processos no grupo gerenciado pelo Playwright.
    // pnpm exec cria outro grupo no pnpm 12 e pode deixar servidores órfãos no teardown.
    // Os webServers iniciam em ordem no Playwright adotado: o primeiro prepara o
    // banco antes de ouvir; só então worker e Next iniciam. Não usar globalSetup,
    // pois esse hook executa após o setup dos webServers.
    {
      command: 'node --import tsx ../../apps/web/e2e/start-api.ts',
      cwd: path.join(ROOT, 'apps/api'),
      url: `${API_URL}/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: 'node --import tsx src/worker.ts',
      cwd: path.join(ROOT, 'apps/api'),
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      wait: { stdout: /Worker pronto/ },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: `node node_modules/next/dist/bin/next dev --port ${WEB_PORT}`,
      cwd: import.meta.dirname,
      url: `${WEB_URL}/login`,
      env: {
        API_INTERNAL_URL: API_URL,
        NEXT_DIST_DIR: process.env.E2E_NEXT_DIST_DIR ?? '.next-e2e',
      },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      timeout: 180_000,
    },
  ],
});
