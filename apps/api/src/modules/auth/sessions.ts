import { systemDb } from '@botsaas/database';
import type { AuthContext } from '../../context';
import { randomToken, sha256 } from '../../lib/crypto';

export const SESSION_COOKIE = 'sid';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function createSession(input: {
  userId: string;
  ttlDays: number;
  activeCompanyId: string | null;
  ip?: string;
  userAgent?: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
  await systemDb.session.create({
    data: {
      tokenHash: sha256(token),
      userId: input.userId,
      activeCompanyId: input.activeCompanyId,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300),
    },
  });
  return { token, expiresAt };
}

/** Carrega a sessão pelo token do cookie. Sessões expiradas ou de usuários inativos são descartadas. */
export async function loadSession(token: string): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const session = await systemDb.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || !session.user.isActive) {
    await systemDb.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await systemDb.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now) },
    });
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      platformRole: session.user.platformRole,
      mustChangePassword: session.user.mustChangePassword,
    },
    session: {
      id: session.id,
      activeCompanyId: session.activeCompanyId,
      supportCompanyId: session.supportCompanyId,
      supportExpiresAt: session.supportExpiresAt,
    },
  };
}

export async function destroySession(sessionId: string): Promise<void> {
  await systemDb.session.deleteMany({ where: { id: sessionId } });
}

/** Encerra todas as sessões de um usuário (ex.: troca de senha, remoção). */
export async function destroyUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await systemDb.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}
