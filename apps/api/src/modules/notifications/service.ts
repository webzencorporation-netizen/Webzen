import { systemDb } from '@botsaas/database';
import { NotFoundError } from '@botsaas/shared';

/**
 * Leitura de notificações. O registro de leitura (NotificationRead) é por usuário e não tem
 * companyId, por isso fica fora dos módulos de empresa — todo acesso filtra pelo companyId
 * do escopo E pelo usuário.
 */
export async function listNotifications(
  companyId: string,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number },
) {
  const notifications = await systemDb.notification.findMany({
    where: {
      companyId,
      OR: [{ userId: null }, { userId }],
      ...(options.unreadOnly ? { reads: { none: { userId } } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 30,
    include: { reads: { where: { userId }, select: { readAt: true } } },
  });
  const unread = await systemDb.notification.count({
    where: { companyId, OR: [{ userId: null }, { userId }], reads: { none: { userId } } },
  });
  return {
    unread,
    items: notifications.map(({ reads, ...notification }) => ({
      ...notification,
      readAt: reads[0]?.readAt ?? null,
    })),
  };
}

export async function markNotificationRead(
  companyId: string,
  userId: string,
  notificationId: string,
) {
  const notification = await systemDb.notification.findFirst({
    where: { id: notificationId, companyId, OR: [{ userId: null }, { userId }] },
  });
  if (!notification) throw new NotFoundError('Notificação não encontrada.');
  await systemDb.notificationRead.upsert({
    where: { notificationId_userId: { notificationId, userId } },
    create: { notificationId, userId },
    update: {},
  });
}

export async function markAllNotificationsRead(companyId: string, userId: string) {
  const unread = await systemDb.notification.findMany({
    where: { companyId, OR: [{ userId: null }, { userId }], reads: { none: { userId } } },
    select: { id: true },
    take: 500,
  });
  if (unread.length === 0) return;
  await systemDb.notificationRead.createMany({
    data: unread.map((item) => ({ notificationId: item.id, userId })),
    skipDuplicates: true,
  });
}
