import { disconnectSystemDb } from '@botsaas/database';
import { buildApp } from './app';
import { bootstrapContainer } from './bootstrap';

async function main() {
  const container = bootstrapContainer('botsaas-api');
  const app = await buildApp(container);
  const { env, logger } = container;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando API');
    await app.close();
    await container.queue.close();
    container.redis?.disconnect();
    await disconnectSystemDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info(
    { url: env.API_PUBLIC_URL, webhook: `${env.API_PUBLIC_URL}/webhooks/whatsapp` },
    'API pronta',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
