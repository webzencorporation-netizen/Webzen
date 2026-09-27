/**
 * Sobe PostgreSQL e Redis locais SEM Docker (útil em máquinas sem Docker/sudo).
 * Com Docker disponível, prefira `docker compose up -d`.
 *
 *   pnpm services:local
 *
 * Dados persistem em `.local/` (ignorado pelo git). Ctrl+C encerra ambos.
 */
import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';

const ROOT = path.resolve(import.meta.dirname, '..');
const PG_PORT = Number(process.env.LOCAL_PG_PORT ?? 5432);
const REDIS_PORT = Number(process.env.LOCAL_REDIS_PORT ?? 6379);
const PG_USER = 'botsaas';
const PG_PASSWORD = 'botsaas';
const DATABASES = ['botsaas', 'botsaas_test'];

async function startPostgres() {
  const dataDir = path.join(ROOT, '.local', 'postgres');
  const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
    onLog: () => {},
  });
  if (!alreadyInitialised) await pg.initialise();
  await pg.start();
  for (const database of DATABASES) {
    try {
      await pg.createDatabase(database);
    } catch {
      // já existe
    }
  }
  return pg;
}

async function startRedis() {
  return RedisMemoryServer.create({ instance: { port: REDIS_PORT } });
}

async function main() {
  fs.mkdirSync(path.join(ROOT, '.local'), { recursive: true });
  const pg = await startPostgres();
  const redis = await startRedis();
  console.log('\nServiços locais prontos:');
  console.log(`  DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/botsaas`);
  console.log(
    `  TEST_DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/botsaas_test`,
  );
  console.log(`  REDIS_URL=redis://localhost:${await redis.getPort()}`);
  console.log('\nCtrl+C para encerrar.');

  const shutdown = async () => {
    console.log('\nEncerrando...');
    await Promise.allSettled([pg.stop(), redis.stop()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
