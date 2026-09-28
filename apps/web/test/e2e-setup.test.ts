import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect = runtime.connect;
      query = runtime.query;
      end = runtime.end;
    },
  },
}));
vi.mock('node:child_process', () => ({ execFileSync: runtime.exec }));

import prepareDatabase from '../e2e/global-setup';

const urlFor = (name: string) =>
  `postgresql://fixture-user:fixture-password@localhost:5432/${name}`;

beforeEach(() => {
  vi.resetAllMocks();
  runtime.connect.mockResolvedValue(undefined);
  runtime.query.mockResolvedValue(undefined);
  runtime.end.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('destino destrutivo do E2E', () => {
  it.each([
    'postgres',
    'botsaas',
    'botsaas_test',
    'production_e2e',
    'botsaas_note2e',
    'botsaas_e2e/other',
    'botsaas_e2e";DROP DATABASE postgres;--',
    'botsaas_e2e%22',
    'botsaas_e2e__resume',
    `botsaas_e2e_${'a'.repeat(53)}`,
  ])('recusa o identificador %s antes de conectar', async (name) => {
    vi.stubEnv('E2E_DATABASE_URL', urlFor(name));
    await expect(prepareDatabase()).rejects.toThrow(/E2E/);
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.query).not.toHaveBeenCalled();
    expect(runtime.exec).not.toHaveBeenCalled();
  });

  it.each([
    'https://fixture-user:fixture-password@localhost/botsaas_e2e',
    `${urlFor('botsaas_e2e')}?dbname=postgres`,
    `${urlFor('botsaas_e2e')}?host=production`,
    `${urlFor('botsaas_e2e')}#ignored`,
    'postgresql:///botsaas_e2e',
    'not-a-url-fixture-password',
    'postgresql://fixture-user:fixture-password@localhost:0/botsaas_e2e',
    `${urlFor('botsaas_e2e')}\n`,
  ])('rejeita URL ambígua sem conexão ou exposição de credenciais (%#)', async (url) => {
    vi.stubEnv('E2E_DATABASE_URL', url);
    const error = await prepareDatabase().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('fixture-password');
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.exec).not.toHaveBeenCalled();
  });

  it.each(['botsaas_e2e', 'botsaas_e2e_resume', 'botsaas_ci_e2e'])(
    'prepara o preset %s sem forçar encerramento de conexões',
    async (database) => {
      vi.stubEnv('E2E_DATABASE_URL', urlFor(database));
      const operations: string[] = [];
      runtime.query.mockImplementation(async (sql: string) => {
        operations.push(sql);
      });
      runtime.exec.mockImplementation((_command: string, args: string[]) => {
        operations.push(args.includes('prisma') ? 'migrate' : 'seed');
      });
      await prepareDatabase();
      expect(operations).toEqual([
        `DROP DATABASE IF EXISTS "${database}"`,
        `CREATE DATABASE "${database}"`,
        'migrate',
        'seed',
      ]);
      expect(runtime.end).toHaveBeenCalledOnce();
    },
  );

  it('fecha a conexão administrativa após falha sem executar migração/seed', async () => {
    vi.stubEnv('E2E_DATABASE_URL', urlFor('botsaas_e2e'));
    runtime.query.mockRejectedValueOnce(new Error('database in use fixture-password'));
    const error = await prepareDatabase().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('E2E');
    expect((error as Error).message).not.toContain('fixture-password');
    expect(runtime.end).toHaveBeenCalledOnce();
    expect(runtime.exec).not.toHaveBeenCalled();
  });

  it('falha de migração impede seed e não imprime stderr com credenciais', async () => {
    vi.stubEnv('E2E_DATABASE_URL', urlFor('botsaas_e2e'));
    runtime.exec.mockImplementationOnce(() => {
      throw new Error('fixture-password');
    });
    const error = await prepareDatabase().catch((caught: unknown) => caught);
    expect((error as Error).message).toContain('migrações E2E');
    expect((error as Error).message).not.toContain('fixture-password');
    expect(runtime.exec).toHaveBeenCalledOnce();
  });
});
