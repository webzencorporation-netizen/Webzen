import { getEnv, type Env } from '@botsaas/config';
import { Redis } from 'ioredis';
import { createContainer, type AppContainer } from './container';
import { createLogger } from './lib/logger';
import { BullJobQueue, redisConnectionFromUrl } from './queues/bullmq';

/** Monta o container de produção/desenvolvimento a partir do ambiente. */
export function bootstrapContainer(serviceName: string, env: Env = getEnv()): AppContainer {
  process.env.SERVICE_NAME = serviceName;
  const logger = createLogger(env.LOG_LEVEL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  redis.on('error', (error) => logger.error({ err: error }, 'Erro de conexão com Redis'));
  const queue = new BullJobQueue(redisConnectionFromUrl(env.REDIS_URL));
  return createContainer({ env, logger, queue, redis });
}
