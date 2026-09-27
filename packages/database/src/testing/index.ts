import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { SystemDb } from '../client';

const DATABASE_PACKAGE_DIR = path.resolve(import.meta.dirname, '../..');

/**
 * Aplica migrações pendentes no banco de testes (não destrutivo). A limpeza de dados entre
 * testes é feita por `truncateAllTables`, que só roda em bancos com "test" no nome.
 */
export function migrateTestDatabase(databaseUrl: string): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: DATABASE_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}

/** Garante que nunca rodaremos testes destrutivos contra um banco que não seja de teste. */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  const name = new URL(databaseUrl).pathname.replace('/', '');
  if (!/test/i.test(name)) {
    throw new Error(
      `Recusado: o banco de testes deve conter "test" no nome (recebido "${name}"). Configure TEST_DATABASE_URL.`,
    );
  }
}

/** Limpa todas as tabelas (mantém o histórico de migrações). */
export async function truncateAllTables(db: SystemDb): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
