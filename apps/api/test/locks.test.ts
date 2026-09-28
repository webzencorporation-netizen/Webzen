import type { Redis, RedisOptions } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withLock, type LockLease } from '../src/lib/locks';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Transporte determinístico: o estado representa somente SET NX PX e os dois scripts Lua.
function redisFixture() {
  let value: { token: string; expires: number } | undefined;
  const clients: ReturnType<typeof client>[] = [];
  const hanging = new Set<string>();
  const failures = new Set<string>();
  const delayed = new Map<string, ReturnType<typeof deferred<unknown>>>();
  function client() {
    const pending: Array<(error: Error) => void> = [];
    const listeners = new Map<string, () => void>();
    function command<T>(kind: string, run: () => T): Promise<T> {
      if (delayed.has(kind)) return delayed.get(kind)!.promise as Promise<T>;
      if (failures.has(kind)) return Promise.reject(new Error('Redis unavailable'));
      if (hanging.has(kind)) return new Promise<T>((_, reject) => pending.push(reject));
      return Promise.resolve(run());
    }
    const connection = {
      options: {} as RedisOptions,
      on: (event: string, listener: () => void) => {
        listeners.set(event, listener);
      },
      closeSocket: () => {
        listeners.get('close')?.();
      },
      connect: () => command('connect', () => undefined),
      disconnect: vi.fn(() => {
        for (const reject of pending) reject(new Error('Connection closed'));
      }),
      duplicate(options: RedisOptions) {
        const child = client();
        child.options = options;
        clients.push(child);
        return child;
      },
      set(_key: string, token: string, _px: string, ttl: number, _nx: string) {
        return command('set', () => {
          if (value && value.expires > performance.now()) return null;
          value = { token, expires: performance.now() + ttl };
          return 'OK';
        });
      },
      eval(script: string, _count: number, _key: string, token: string, ttl?: number) {
        const kind = script.includes('pexpire') ? 'renew' : 'release';
        return command(kind, () => {
          if (!value || value.expires <= performance.now() || value.token !== token) return 0;
          if (kind === 'renew') value.expires = performance.now() + ttl!;
          else value = undefined;
          return 1;
        });
      },
    };
    return connection;
  }
  const shared = client();
  return {
    redis: shared as unknown as Redis,
    shared,
    clients,
    hanging,
    failures,
    delayed,
    steal: () => {
      value = { token: 'successor', expires: performance.now() + 60_000 };
    },
    token: () => value?.token,
  };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

async function activeLock(fixture: ReturnType<typeof redisFixture>, ttl = 9000) {
  const started = deferred();
  const finish = deferred();
  let lease!: LockLease;
  const running = withLock(fixture.redis, 'test', ttl, async (owned) => {
    lease = owned;
    started.resolve();
    await finish.promise;
    return 'done';
  });
  // Handle rejection immediately, including loss occurring while the callback is still running.
  const settled = running.then(
    (value) => ({ value }),
    (error) => ({ error: error as Error }),
  );
  await started.promise;
  return { lease, finish: () => finish.resolve(), settled };
}

describe('lease Redis da conversa', () => {
  it('renova além do TTL original e impede segundo callback até liberar', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    await vi.advanceTimersByTimeAsync(27_000);
    const second = await withLock(fixture.redis, 'test', 9000, async () => 'duplicate');
    first.finish();
    expect(second).toBeNull();
    expect(await first.settled).toEqual({ value: 'done' });
    expect(await withLock(fixture.redis, 'test', 9000, async () => 'next')).toBe('next');
    expect(fixture.shared.disconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('perda do token aborta permanentemente e não remove lock do sucessor', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    fixture.steal();
    await vi.advanceTimersByTimeAsync(3000);
    expect(first.lease.signal.aborted).toBe(true);
    expect(() => first.lease.assertOwned()).toThrow(/lease/i);
    first.finish();
    expect(await first.settled).toMatchObject({ error: { name: 'LockLeaseLostError' } });
    expect(fixture.token()).toBe('successor');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['renew', 'release', 'connect', 'set'])(
    '%s pendurado é limitado e fecha somente cliente dedicado',
    async (kind) => {
      const fixture = redisFixture();
      if (kind === 'renew' || kind === 'release') {
        const first = await activeLock(fixture);
        fixture.hanging.add(kind);
        if (kind === 'renew') {
          await vi.advanceTimersByTimeAsync(6000);
          expect(first.lease.signal.aborted).toBe(true);
        }
        first.finish();
        await vi.advanceTimersByTimeAsync(6000);
        expect(await first.settled).toMatchObject(
          kind === 'renew' ? { error: { name: 'LockLeaseLostError' } } : { value: 'done' },
        );
      } else {
        fixture.hanging.add(kind);
        let called = false;
        const running = withLock(fixture.redis, 'test', 9000, async () => {
          called = true;
        });
        const settled = running.catch((error) => error as Error);
        await vi.advanceTimersByTimeAsync(6000);
        expect(await settled).toBeInstanceOf(Error);
        expect(called).toBe(false);
      }
      expect(fixture.clients.every((client) => client.disconnect.mock.calls.length > 0)).toBe(true);
      expect(fixture.shared.disconnect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('fechamento da conexão invalida posse antes da próxima renovação', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    fixture.clients[0]!.closeSocket();
    expect(first.lease.signal.aborted).toBe(true);
    first.finish();
    expect(await first.settled).toMatchObject({ error: { name: 'LockLeaseLostError' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('erro de renovação não é recuperado por conexão posterior', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    fixture.failures.add('renew');
    await vi.advanceTimersByTimeAsync(3000);
    fixture.failures.clear();
    await vi.advanceTimersByTimeAsync(9000);
    expect(first.lease.signal.aborted).toBe(true);
    first.finish();
    expect(await first.settled).toMatchObject({ error: { name: 'LockLeaseLostError' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('assertOwned rejeita após expiração mesmo antes de o timer atrasado executar', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    const now = vi.spyOn(performance, 'now').mockReturnValue(20_000);
    expect(() => first.lease.assertOwned()).toThrow(/lease/i);
    now.mockRestore();
    first.finish();
    expect(await first.settled).toMatchObject({ error: { name: 'LockLeaseLostError' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resposta OK tardia não revive lease perdida por timeout', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    const late = deferred<unknown>();
    fixture.delayed.set('renew', late);
    await vi.advanceTimersByTimeAsync(6000);
    expect(first.lease.signal.aborted).toBe(true);
    late.resolve(1);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(() => first.lease.assertOwned()).toThrow(/lease/i);
    first.finish();
    expect(await first.settled).toMatchObject({ error: { name: 'LockLeaseLostError' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('callback termina durante renovação pendente sem prender teardown', async () => {
    const fixture = redisFixture();
    const first = await activeLock(fixture);
    fixture.hanging.add('renew');
    await vi.advanceTimersByTimeAsync(3000);
    first.finish();
    await vi.advanceTimersByTimeAsync(6000);
    expect(await first.settled).toEqual({ value: 'done' });
    expect(vi.getTimerCount()).toBe(0);
    expect(fixture.shared.disconnect).not.toHaveBeenCalled();
  });

  it('erro do callback libera lock e todos os timers', async () => {
    const fixture = redisFixture();
    await expect(
      withLock(fixture.redis, 'test', 9000, async () => {
        throw new Error('callback');
      }),
    ).rejects.toThrow('callback');
    expect(await withLock(fixture.redis, 'test', 9000, async () => 'next')).toBe('next');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fallback local oferece a mesma interface e libera posse após exceção', async () => {
    await expect(
      withLock(null, 'local', 100, async (lease) => {
        lease.assertOwned();
        expect(lease.signal.aborted).toBe(false);
        throw new Error('local');
      }),
    ).rejects.toThrow('local');
    expect(
      await withLock(null, 'local', 100, async (lease) => {
        lease.assertOwned();
        return 'next';
      }),
    ).toBe('next');
    expect(vi.getTimerCount()).toBe(0);
  });
});
