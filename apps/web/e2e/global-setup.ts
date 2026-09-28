import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { PASSWORD, PLATFORM_ADMIN } from './fixtures';
import { DEFAULT_E2E_DATABASE_URL, resolveE2eDatabaseTarget } from './database-target';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** Chamado pelo bootstrap da API E2E, antes de qualquer servidor da pilha iniciar. */
export default async function prepareDatabase() {
  const target = resolveE2eDatabaseTarget(process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL);
  const client = new pg.Client({ connectionString: target.adminConnectionString });
  try {
    await client.connect();
    // Identificador estritamente validado; não força a desconexão de serviços existentes.
    await client.query(`DROP DATABASE IF EXISTS "${target.database}"`);
    await client.query(`CREATE DATABASE "${target.database}"`);
  } catch {
    throw new Error(
      'Falha ao preparar banco E2E. Confira acesso e se há conexões usando o banco de teste.',
    );
  } finally {
    await client.end().catch(() => undefined);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: target.connectionString,
    NODE_ENV: 'development',
    AI_PROVIDER: 'mock',
    WHATSAPP_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'local',
    STT_PROVIDER: 'mock',
    // O shell de quem executa não pode alterar as credenciais esperadas pelos cenários.
    SEED_ADMIN_EMAIL: PLATFORM_ADMIN,
    SEED_ADMIN_PASSWORD: PASSWORD,
  };
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: path.join(ROOT, 'packages/database'),
      env,
      stdio: 'pipe',
    });
  } catch {
    throw new Error(
      'Falha ao aplicar migrações E2E. Verifique o banco descartável e as migrações.',
    );
  }
  try {
    execFileSync('pnpm', ['exec', 'tsx', 'src/seed/run.ts'], {
      cwd: path.join(ROOT, 'apps/api'),
      env,
      stdio: 'pipe',
    });
  } catch {
    throw new Error(
      'Falha ao criar dados de demonstração E2E. Verifique a configuração de testes.',
    );
  }
}
