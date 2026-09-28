import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrismaClient, hashPassword, verifyPassword } from '@botsaas/database';
import { assertTestDatabaseUrl, truncateAllTables } from '@botsaas/database/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapPlatformOwner } from '../src/modules/platform/bootstrap-owner';
import { TEST_DATABASE_URL } from './helpers/test-env';

assertTestDatabaseUrl(TEST_DATABASE_URL);
const db = createPrismaClient({ connectionString: TEST_DATABASE_URL });
const input = {
  email: ' OWNER@example.test ',
  name: ' Primeiro Dono ',
  password: 'teste-bootstrap-123',
};

beforeEach(() => truncateAllTables(db));
afterAll(() => db.$disconnect());

function runCli(
  options: {
    vars?: Record<string, string | undefined>;
    stdin?: string;
    args?: string[];
  } = {},
): Promise<{ code: number | null; output: string }> {
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    BOOTSTRAP_OWNER_EMAIL: input.email,
    BOOTSTRAP_OWNER_NAME: input.name,
    BOOTSTRAP_OWNER_PASSWORD: input.password,
    ...options.vars,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        fileURLToPath(import.meta.resolve('tsx')),
        path.resolve(import.meta.dirname, '../src/bootstrap-owner.ts'),
        ...(options.args ?? []),
      ],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
    child.stdin.end(options.stdin ?? '');
  });
}

describe('bootstrap do primeiro proprietário de plataforma', () => {
  it('cria owner com senha Argon2 e auditoria, preservando dados existentes', async () => {
    const existing = await db.user.create({
      data: {
        email: 'customer@example.test',
        name: 'Cliente',
        passwordHash: await hashPassword('senha-cliente-123'),
      },
    });
    const result = await bootstrapPlatformOwner(input, db);
    const owner = await db.user.findUnique({
      where: { id: result.id || '00000000-0000-0000-0000-000000000000' },
    });
    expect(owner).toMatchObject({
      email: 'owner@example.test',
      name: 'Primeiro Dono',
      platformRole: 'PLATFORM_OWNER',
      isActive: true,
    });
    expect(owner?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(owner!.passwordHash, input.password)).toBe(true);
    expect(result).not.toHaveProperty('passwordHash');
    expect(await db.user.findUnique({ where: { id: existing.id } })).toEqual(existing);
    const logs = await db.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: 'SYSTEM',
      action: 'platform.owner_bootstrapped',
      resourceType: 'User',
      resourceId: owner!.id,
      companyId: null,
    });
    expect(JSON.stringify(logs)).not.toContain(input.password);
    expect(JSON.stringify(logs)).not.toContain(owner!.passwordHash);
  });

  it.each(['PLATFORM_OWNER', 'PLATFORM_ADMIN'] as const)(
    'recusa novo bootstrap quando existe %s inativo',
    async (platformRole) => {
      const existing = await db.user.create({
        data: {
          email: 'admin@example.test',
          name: 'Administrador',
          passwordHash: 'existing-hash',
          platformRole,
          isActive: false,
        },
      });
      await expect(bootstrapPlatformOwner(input, db)).rejects.toThrow();
      expect(await db.user.findMany()).toEqual([existing]);
      expect(await db.auditLog.count()).toBe(0);
    },
  );

  it('não promove nem substitui usuário existente, inclusive e-mail com caixa diferente', async () => {
    const existing = await db.user.create({
      data: {
        email: 'OWNER@example.test',
        name: 'Usuário',
        passwordHash: 'original-hash',
      },
    });
    await expect(bootstrapPlatformOwner(input, db)).rejects.toThrow();
    expect(await db.user.findMany()).toEqual([existing]);
    expect(await db.auditLog.count()).toBe(0);
  });

  it.each([
    { email: '' },
    { email: 'inválido' },
    { name: ' ' },
    { password: '' },
    { password: 'curta' },
  ])('recusa entrada inválida sem gravar usuário: %j', async (invalid) => {
    await expect(bootstrapPlatformOwner({ ...input, ...invalid }, db)).rejects.toThrow();
    expect(await db.user.count()).toBe(0);
  });

  it('serializa dois bootstraps concorrentes e cria somente um proprietário', async () => {
    const results = await Promise.allSettled([
      bootstrapPlatformOwner(input, db),
      bootstrapPlatformOwner({ ...input, email: 'second@example.test' }, db),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count({ where: { platformRole: 'PLATFORM_OWNER' } })).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  it('reverte criação do usuário se a auditoria falhar', async () => {
    await db.$executeRawUnsafe(
      `ALTER TABLE "AuditLog" ADD CONSTRAINT bootstrap_test_reject CHECK (action <> 'platform.owner_bootstrapped')`,
    );
    try {
      await expect(bootstrapPlatformOwner(input, db)).rejects.toThrow();
      expect(await db.user.count()).toBe(0);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT bootstrap_test_reject');
    }
  });

  it('CLI usa ambiente explícito e não imprime senha ou hash', async () => {
    const result = await runCli();
    expect(result.code, result.output).toBe(0);
    expect(await db.user.count({ where: { platformRole: 'PLATFORM_OWNER' } })).toBe(1);
    expect(result.output).not.toContain(input.password);
    expect(result.output).not.toContain('$argon2');
  });

  it('CLI aceita senha pela entrada padrão sem exibi-la', async () => {
    const result = await runCli({
      vars: { BOOTSTRAP_OWNER_PASSWORD: undefined },
      stdin: `${input.password}\n`,
    });
    expect(result.code, result.output).toBe(0);
    const owner = await db.user.findFirstOrThrow();
    expect(await verifyPassword(owner.passwordHash, input.password)).toBe(true);
    expect(result.output).not.toContain(input.password);
  });

  it('CLI recusa senha em argv e não usa defaults de demonstração', async () => {
    const argv = await runCli({ args: ['--password', 'segredo-argv-123'] });
    expect(argv.code).not.toBe(0);
    expect(argv.output).not.toContain('segredo-argv-123');
    const missing = await runCli({
      vars: {
        BOOTSTRAP_OWNER_EMAIL: undefined,
        BOOTSTRAP_OWNER_NAME: undefined,
        BOOTSTRAP_OWNER_PASSWORD: undefined,
        SEED_ADMIN_EMAIL: 'demo@example.test',
        SEED_ADMIN_PASSWORD: 'senha-demo-123',
      },
    });
    expect(missing.code).not.toBe(0);
    expect(await db.user.count()).toBe(0);
  });
});
