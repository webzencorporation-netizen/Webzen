import { createServer, type Socket } from 'node:net';
import { Redis } from 'ioredis';
import { expect, it } from 'vitest';
import { withLock } from '../src/lib/locks';

it('ioredis real encerra conexão sem resposta sem desconectar o cliente compartilhado', async () => {
  const sockets = new Set<Socket>();
  const closed: Promise<void>[] = [];
  // Aceita TCP, mas nunca responde ao handshake Redis. Nenhum serviço externo.
  const server = createServer((socket) => {
    sockets.add(socket);
    closed.push(
      new Promise<void>((resolve) =>
        socket.once('close', () => {
          sockets.delete(socket);
          resolve();
        }),
      ),
    );
    socket.on('data', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP port');
  const shared = new Redis({
    host: '127.0.0.1',
    port: address.port,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  try {
    let called = false;
    await expect(
      withLock(shared, 'socket-timeout', 9000, async () => {
        called = true;
      }),
    ).rejects.toThrow(/timeout|timed out|closed/i);
    expect(called).toBe(false);
    expect(shared.status).toBe('wait');
    await Promise.all(closed);
    expect(sockets.size).toBe(0);
  } finally {
    shared.disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
