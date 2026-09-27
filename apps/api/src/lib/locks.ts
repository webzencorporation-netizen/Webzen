import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const localLocks = new Set<string>();

/**
 * Lock distribuído simples (Redis SET NX PX). Sem Redis (testes), usa lock em memória do processo.
 * Retorna `null` quando o lock já está com outro processo.
 */
export async function withLock<T>(
  redis: Redis | null,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lockKey = `botsaas:lock:${key}`;
  if (!redis) {
    if (localLocks.has(lockKey)) return null;
    localLocks.add(lockKey);
    try {
      return await fn();
    } finally {
      localLocks.delete(lockKey);
    }
  }
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') return null;
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, token).catch(() => undefined);
  }
}
