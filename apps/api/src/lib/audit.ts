import { systemDb, type Prisma } from '@botsaas/database';
import type { Actor, TenantContext } from '../context';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Somente metadados seguros — nunca segredos, tokens ou conteúdo sensível. */
  metadata?: Record<string, unknown>;
}

function actorFields(actor: Actor) {
  return {
    actorType: actor.type,
    actorUserId: actor.userId ?? null,
    actorLabel: actor.label ?? null,
  };
}

/** Registra ação administrativa dentro de uma empresa. */
export async function audit(
  ctx: Pick<TenantContext, 'db' | 'actor' | 'ip' | 'isSupportMode'>,
  entry: AuditEntry,
): Promise<void> {
  await ctx.db.auditLog.create({
    data: {
      ...actorFields(ctx.actor),
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: {
        ...(entry.metadata ?? {}),
        ...(ctx.isSupportMode ? { supportMode: true } : {}),
      } as Prisma.InputJsonValue,
      ip: ctx.ip ?? null,
    },
  });
}

/** Registra ação da área da plataforma (companyId opcional). */
export async function auditPlatform(
  actor: Actor,
  entry: AuditEntry & { companyId?: string | null; ip?: string },
): Promise<void> {
  await systemDb.auditLog.create({
    data: {
      ...actorFields(actor),
      companyId: entry.companyId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      ip: entry.ip ?? null,
    },
  });
}
