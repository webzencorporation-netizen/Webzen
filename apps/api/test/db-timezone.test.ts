import { createPrismaClient, systemDb } from '@botsaas/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './helpers/test-env';

/**
 * O adapter-pg envia `Date` sem fuso; com o servidor fora de UTC (ex.: Postgres local que herda
 * o fuso da máquina) o banco gravava o horário deslocado. O Prisma "desfazia" na leitura, mas
 * `now()`/`@default(now())` e todo SQL com datas (relatórios por dia) ficavam errados.
 * Aqui o banco de teste é configurado fora de UTC para reproduzir em qualquer ambiente.
 */

const database = new URL(TEST_DATABASE_URL).pathname.slice(1);
const probeModel = 'fuso-teste-sem-deslocamento';

beforeAll(async () => {
  await systemDb.$executeRawUnsafe(
    `ALTER DATABASE "${database}" SET timezone TO 'America/Sao_Paulo'`,
  );
});

afterAll(async () => {
  await systemDb.$executeRawUnsafe(`ALTER DATABASE "${database}" RESET timezone`);
  await systemDb.modelPricing.deleteMany({ where: { model: probeModel } });
});

describe('datas no banco com servidor fora de UTC', () => {
  it('a sessão do app roda em UTC e o instante gravado é o instante enviado', async () => {
    // Client novo: suas conexões nascem depois do ALTER DATABASE.
    const client = createPrismaClient({ connectionString: TEST_DATABASE_URL, maxConnections: 1 });
    try {
      const [session] = await client.$queryRaw<{ tz: string }[]>`
        SELECT current_setting('TimeZone') AS tz`;
      expect(session?.tz).toBe('UTC');

      const probe = new Date('2026-09-10T02:30:00Z');
      const row = await client.modelPricing.create({
        data: {
          model: probeModel,
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 1,
          cacheWriteUsdPerMTok: 1,
          cacheReadUsdPerMTok: 1,
          createdAt: probe,
        },
      });
      const [stored] = await client.$queryRaw<{ epoch: number; local: string }[]>`
        SELECT extract(epoch FROM "createdAt")::float8 AS epoch,
               to_char("createdAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS local
          FROM "ModelPricing" WHERE id = ${row.id}::uuid`;
      expect(stored?.epoch).toBe(probe.getTime() / 1000);
      expect(stored?.local).toBe('2026-09-09 23:30');
      expect(
        (await client.modelPricing.findUniqueOrThrow({ where: { id: row.id } })).createdAt,
      ).toEqual(probe);
    } finally {
      await client.$disconnect();
    }
  });
});
