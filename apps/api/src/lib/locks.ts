import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const RENEW_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const localLocks = new Set<string>();
const COMMAND_TIMEOUT_MS = 2_000;

export class LockLeaseLostError extends Error {
  constructor(message = 'Conversation lease lost', options?: ErrorOptions) {
    super(message, options);
    this.name = 'LockLeaseLostError';
  }
}

export interface LockLease {
  readonly signal: AbortSignal;
  /** Verifica também o prazo monotônico, mesmo se o event loop atrasou o watchdog. */
  assertOwned(): void;
}

/**
 * Lease renovável por token; null significa contenção, falhas de Redis lançam erro.
 * O callback deve conferir a posse antes de efeitos. Não há fencing com PostgreSQL,
 * nem cancelamento de requests/tools em voo. Sem Redis, o lock é local ao processo.
 */
export async function withLock<T>(
  redis: Redis | null,
  key: string,
  ttlMs: number,
  fn: (lease: LockLease) => Promise<T>,
): Promise<T | null> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Invalid lease TTL');
  const lockKey = `botsaas:lock:${key}`;
  const controller = new AbortController();
  if (!redis) {
    if (localLocks.has(lockKey)) return null;
    localLocks.add(lockKey);
    try {
      return await fn({
        signal: controller.signal,
        assertOwned: () => controller.signal.throwIfAborted(),
      });
    } finally {
      controller.abort(new LockLeaseLostError('Conversation lease ended'));
      localLocks.delete(lockKey);
    }
  }

  // Nunca herdar a fila offline/retries ilimitados da conexão BullMQ/compartilhada.
  // A conexão pertence a esta lease e pode ser encerrada para limitar comandos presos.
  const timeoutMs = Math.min(COMMAND_TIMEOUT_MS, Math.max(1, Math.floor(ttlMs / 4)));
  const client = redis.duplicate({
    lazyConnect: true,
    enableOfflineQueue: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    commandTimeout: timeoutMs,
    connectTimeout: timeoutMs,
  });
  client.on('error', () => undefined); // Erros chegam aos comandos e invalidam a lease.
  let disconnected = false;
  function disconnect() {
    if (disconnected) return;
    disconnected = true;
    client.disconnect();
  }
  function bounded<R>(operation: () => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Redis lease command timed out'));
        disconnect();
      }, timeoutMs);
      timer.unref();
      // Ambos os caminhos consomem respostas/rejeições tardias e limpam o timer.
      Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
  }

  const token = randomUUID();
  let acquired = false;
  let stopped = false;
  let deadline = 0;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  function lose(cause?: unknown) {
    if (controller.signal.aborted) return;
    controller.abort(new LockLeaseLostError('Conversation lease lost', { cause }));
    clearTimeout(renewTimer);
    clearTimeout(expiryTimer);
    disconnect();
  }
  client.on('close', () => {
    if (acquired && !stopped) lose(new Error('Redis lease connection closed'));
  });
  const lease: LockLease = {
    signal: controller.signal,
    assertOwned() {
      if (performance.now() >= deadline) lose(new Error('Lease deadline expired'));
      controller.signal.throwIfAborted();
    },
  };
  function watchExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(
      () => lose(new Error('Lease deadline expired')),
      Math.max(0, deadline - performance.now()),
    );
    expiryTimer.unref();
  }
  function scheduleRenewal() {
    if (stopped || controller.signal.aborted) return;
    renewTimer = setTimeout(
      () => {
        renewal = renew().finally(() => {
          renewal = undefined;
        });
      },
      Math.max(1, Math.floor(ttlMs / 3)),
    );
    renewTimer.unref();
  }
  async function renew() {
    try {
      lease.assertOwned();
      const started = performance.now();
      const renewed = await bounded(() => client.eval(RENEW_SCRIPT, 1, lockKey, token, ttlMs));
      if (stopped) return;
      // Não ressuscitar a lease depois do prazo/perda, mesmo com resposta tardia OK.
      lease.assertOwned();
      if (renewed !== 1) {
        lose(new Error('Lease token changed'));
        return;
      }
      deadline = started + ttlMs;
      watchExpiry();
      scheduleRenewal();
    } catch (error) {
      if (!stopped) lose(error);
    }
  }

  try {
    await bounded(() => client.connect());
    const started = performance.now();
    acquired = (await bounded(() => client.set(lockKey, token, 'PX', ttlMs, 'NX'))) === 'OK';
    if (!acquired) return null;
    deadline = started + ttlMs;
    lease.assertOwned();
    watchExpiry();
    scheduleRenewal();
    try {
      const result = await fn(lease);
      lease.assertOwned();
      return result;
    } catch (error) {
      lease.assertOwned();
      throw error;
    }
  } finally {
    stopped = true;
    clearTimeout(renewTimer);
    clearTimeout(expiryTimer);
    // Espera somente renovação limitada por timeout; nunca abandona promise rejeitada.
    await renewal;
    if (acquired && !disconnected) {
      await bounded(() => client.eval(RELEASE_SCRIPT, 1, lockKey, token)).catch(() => undefined);
    }
    disconnect();
    controller.abort(new LockLeaseLostError('Conversation lease ended'));
  }
}
