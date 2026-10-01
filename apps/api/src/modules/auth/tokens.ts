import { systemDb, type AuthTokenType } from '@botsaas/database';
import { ValidationError } from '@botsaas/shared';
import { randomToken, sha256 } from '../../lib/crypto';

export const AUTH_TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFICATION: 48 * 3600_000,
  PASSWORD_RESET: 60 * 60_000,
};

const INVALID_LINK = 'Link inválido ou expirado. Peça um novo.';

/**
 * Emite um token de uso único e invalida os anteriores do mesmo tipo (só o link mais
 * recente vale). O valor bruto vai no e-mail; o banco guarda apenas o SHA-256.
 */
export async function issueAuthToken(
  user: { id: string; email: string },
  type: AuthTokenType,
  now: Date = new Date(),
): Promise<string> {
  const token = randomToken(32);
  await systemDb.$transaction([
    systemDb.authToken.updateMany({
      where: { userId: user.id, type, usedAt: null },
      data: { usedAt: now },
    }),
    systemDb.authToken.create({
      data: {
        userId: user.id,
        type,
        tokenHash: sha256(token),
        email: user.email,
        expiresAt: new Date(now.getTime() + AUTH_TOKEN_TTL_MS[type]),
      },
    }),
  ]);
  return token;
}

/**
 * Consome o token: precisa existir, ser do tipo certo, não ter sido usado, estar no prazo e
 * ter sido emitido para o e-mail atual do usuário. A marcação de uso é atômica (dois cliques
 * simultâneos no mesmo link não passam os dois).
 */
export async function consumeAuthToken(
  rawToken: string,
  type: AuthTokenType,
  now: Date = new Date(),
): Promise<{ userId: string }> {
  if (!rawToken || rawToken.length > 200) throw new ValidationError(INVALID_LINK);
  const token = await systemDb.authToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: { select: { email: true, isActive: true } } },
  });
  if (
    !token ||
    token.type !== type ||
    token.usedAt !== null ||
    token.expiresAt.getTime() <= now.getTime() ||
    token.email !== token.user.email ||
    !token.user.isActive
  ) {
    throw new ValidationError(INVALID_LINK);
  }
  const claimed = await systemDb.authToken.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw new ValidationError(INVALID_LINK);
  return { userId: token.userId };
}
