import { systemDb } from '@botsaas/database';
import { describeProviders } from '@botsaas/config';
import type { AppContainer } from '../../container';

export const WORKER_HEARTBEAT_KEY = 'botsaas:worker:heartbeat';
const HEARTBEAT_STALE_MS = 60_000;

type Status = 'ok' | 'degraded' | 'down' | 'not_configured' | 'mock';

interface ComponentHealth {
  status: Status;
  detail?: string;
}

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - started, value };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : 'erro',
    };
  }
}

/** Saúde simples dos componentes para o painel da plataforma. */
export async function getPlatformHealth(container: AppContainer) {
  const { providers, redis, env } = container;
  const components: Record<string, ComponentHealth> = {};

  const db = await timed(() => systemDb.$queryRaw`SELECT 1`);
  components.database = db.ok
    ? { status: 'ok', detail: `${db.ms} ms` }
    : { status: 'down', detail: db.error };

  if (redis) {
    const ping = await timed(() => redis.ping());
    components.redis = ping.ok
      ? { status: 'ok', detail: `${ping.ms} ms` }
      : { status: 'down', detail: ping.error };
    const heartbeat = await timed(() => redis.get(WORKER_HEARTBEAT_KEY));
    const last = heartbeat.value ? Number(heartbeat.value) : 0;
    components.workers =
      last && Date.now() - last < HEARTBEAT_STALE_MS
        ? { status: 'ok', detail: `último sinal há ${Math.round((Date.now() - last) / 1000)}s` }
        : { status: 'down', detail: 'Nenhum worker ativo recentemente' };
  } else {
    components.redis = { status: 'not_configured' };
    components.workers = { status: 'not_configured' };
  }

  const hourAgo = new Date(Date.now() - 3600_000);
  const [aiRuns, aiFailures, accountsWithError, accounts] = await Promise.all([
    systemDb.agentRun.count({ where: { startedAt: { gte: hourAgo } } }),
    systemDb.agentRun.count({ where: { startedAt: { gte: hourAgo }, status: 'FAILED' } }),
    systemDb.whatsAppAccount.count({ where: { status: 'ERROR' } }),
    systemDb.whatsAppAccount.count(),
  ]);

  components.anthropic =
    providers.ai.name === 'mock'
      ? { status: 'mock', detail: 'Provider simulado' }
      : aiRuns > 0 && aiFailures / aiRuns > 0.2
        ? {
            status: 'degraded',
            detail: `${aiFailures}/${aiRuns} execuções falharam na última hora`,
          }
        : { status: 'ok', detail: `${aiRuns} execuções na última hora` };

  components.whatsapp =
    providers.messaging.name === 'mock'
      ? { status: 'mock', detail: 'Provider simulado' }
      : accountsWithError > 0
        ? { status: 'degraded', detail: `${accountsWithError} de ${accounts} números com erro` }
        : { status: 'ok', detail: `${accounts} números` };

  const storageKey = 'healthcheck/probe.txt';
  const storage = await timed(async () => {
    await providers.storage.put(storageKey, Buffer.from(String(Date.now())), {
      contentType: 'text/plain',
    });
    await providers.storage.get(storageKey);
  });
  components.storage = storage.ok
    ? {
        status: providers.storage.name === 'local' ? 'mock' : 'ok',
        detail: `${providers.storage.name} (${storage.ms} ms)`,
      }
    : { status: 'down', detail: storage.error };

  components.calendar =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { status: 'ok', detail: 'Google OAuth configurado' }
      : { status: 'not_configured', detail: 'Agenda interna ativa; Google não configurado' };

  const statuses = Object.values(components).map((component) => component.status);
  const overall: Status = statuses.includes('down')
    ? 'down'
    : statuses.includes('degraded')
      ? 'degraded'
      : 'ok';
  return { overall, components, providers: describeProviders(env), checkedAt: new Date() };
}
