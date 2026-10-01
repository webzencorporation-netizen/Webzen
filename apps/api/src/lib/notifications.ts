import {
  systemDb,
  type NotificationSeverity,
  type NotificationType,
  type Prisma,
} from '@botsaas/database';
import type { CompanyScope } from '../context';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  severity?: NotificationSeverity;
  userId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Notificação interna do painel. Canal único por enquanto; a interface permite
 * adicionar e-mail/push no futuro sem mudar os chamadores.
 */
export async function notify(scope: CompanyScope, input: NotifyInput): Promise<void> {
  await scope.db.notification.create({
    data: {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      severity: input.severity ?? 'INFO',
      userId: input.userId ?? null,
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Notificação para a equipe WebZen (área da plataforma), fora do escopo de qualquer empresa. */
export async function notifyPlatform(input: Omit<NotifyInput, 'userId'>): Promise<void> {
  await systemDb.notification.create({
    data: {
      companyId: null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      severity: input.severity ?? 'INFO',
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
