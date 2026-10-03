import { hashPassword, PASSWORD_MIN_LENGTH, systemDb, type SystemDb } from '@botsaas/database';
import { z } from 'zod';

export interface BootstrapOwnerInput {
  email: string;
  name: string;
  password: string;
}

export class BootstrapOwnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapOwnerError';
  }
}

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  name: z.string().trim().min(1).max(120),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(200)
    .regex(/\S/)
    .refine((value) => !/[\r\n]/.test(value)),
});

/**
 * Cria somente o PRIMEIRO administrador. Não serve para recuperação/promover usuários.
 * O lock transacional serializa instâncias concorrentes deste bootstrap no mesmo banco.
 */
export async function bootstrapPlatformOwner(
  input: BootstrapOwnerInput,
  db: SystemDb = systemDb,
): Promise<{ id: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BootstrapOwnerError(
      `Informe e-mail válido, nome e senha explícitos (${PASSWORD_MIN_LENGTH}–200 caracteres, uma linha).`,
    );
  }
  const { email, name, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  return db.$transaction(
    async (tx) => {
      // Namespace fixo para bootstrap da plataforma; liberado pelo commit/rollback.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260926, 1)::text`;
      const administrator = await tx.user.findFirst({
        where: { platformRole: { not: null } },
        select: { id: true },
      });
      if (administrator) {
        throw new BootstrapOwnerError('Bootstrap recusado: já existe administrador da plataforma.');
      }
      const existing = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        throw new BootstrapOwnerError('Bootstrap recusado: o e-mail já pertence a um usuário.');
      }
      const owner = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          platformRole: 'PLATFORM_OWNER',
          isActive: true,
          mustChangePassword: false,
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      // Mesmos campos de auditPlatform, usando tx para garantir atomicidade com o usuário.
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          actorLabel: 'bootstrap-owner',
          action: 'platform.owner_bootstrapped',
          resourceType: 'User',
          resourceId: owner.id,
          metadata: { platformRole: 'PLATFORM_OWNER' },
        },
      });
      return owner;
    },
    { isolationLevel: 'ReadCommitted', maxWait: 15_000, timeout: 15_000 },
  );
}
