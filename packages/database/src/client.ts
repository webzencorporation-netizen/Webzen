import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type SystemDb = PrismaClient;

export interface CreateDbOptions {
  connectionString: string;
  /** Tamanho máximo do pool de conexões. */
  maxConnections?: number;
}

export function createPrismaClient({ connectionString, maxConnections = 10 }: CreateDbOptions) {
  const adapter = new PrismaPg({ connectionString, max: maxConnections });
  return new PrismaClient({ adapter });
}

let singleton: SystemDb | undefined;

/**
 * Client SEM escopo de empresa. Use apenas em:
 * autenticação, área da plataforma, webhooks (antes de identificar a empresa) e jobs.
 * Módulos de empresa devem usar `createTenantClient(companyId)`.
 */
export function getSystemDb(): SystemDb {
  if (!singleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL não configurada.');
    singleton = createPrismaClient({ connectionString });
  }
  return singleton;
}

/** Proxy preguiçoso para o client sem escopo (nome explícito para chamar atenção em code review). */
export const systemDb: SystemDb = new Proxy({} as SystemDb, {
  get(_target, property) {
    const client = getSystemDb();
    const value = Reflect.get(client, property) as unknown;
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});

export async function disconnectSystemDb(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}
