import type { Env } from '@botsaas/config';
import type { Logger } from './lib/logger';
import { SecretBox } from './lib/crypto';
import type { JobQueue } from './queues/types';
import { createProviders, type Providers } from './providers';

/**
 * Dependências de infraestrutura compartilhadas por API e worker.
 * Montado uma vez no bootstrap; testes montam versões com mocks.
 */
export interface AppContainer {
  env: Env;
  logger: Logger;
  queue: JobQueue;
  secrets: SecretBox | null;
  providers: Providers;
}

export interface CreateContainerOptions {
  env: Env;
  logger: Logger;
  queue: JobQueue;
  providers?: Partial<Providers>;
}

export function createContainer({ env, logger, queue, providers }: CreateContainerOptions): AppContainer {
  return {
    env,
    logger,
    queue,
    secrets: env.ENCRYPTION_KEY ? new SecretBox(env.ENCRYPTION_KEY) : null,
    providers: { ...createProviders(env, logger), ...providers },
  };
}

/** Exige a chave de criptografia (necessária para salvar tokens de integrações). */
export function requireSecrets(container: AppContainer): SecretBox {
  if (!container.secrets) {
    throw new Error('ENCRYPTION_KEY não configurada — não é possível armazenar credenciais.');
  }
  return container.secrets;
}
