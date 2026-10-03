import { disconnectSystemDb } from '@botsaas/database';
import { Queue, Worker } from 'bullmq';
import { bootstrapContainer } from './bootstrap';
import { JOB_PROCESSORS, runJob } from './jobs/processors';
import { recordError } from './lib/error-log';
import { WORKER_HEARTBEAT_KEY } from './modules/platform/health.service';
import { QUEUE_PREFIX, queueNameFor, redisConnectionFromUrl } from './queues/bullmq';
import { JOB_RETRY_POLICY, type JobName, type JobPayloads } from './queues/types';

async function main() {
  const container = bootstrapContainer('botsaas-worker');
  const { env, logger } = container;
  const connection = redisConnectionFromUrl(env.REDIS_URL);

  const workers = (Object.keys(JOB_PROCESSORS) as JobName[]).map((name) => {
    const definition = JOB_PROCESSORS[name] as (typeof JOB_PROCESSORS)[JobName];
    const worker = new Worker(
      queueNameFor(name),
      async (job) => {
        const log = logger.child({
          jobId: job.id,
          job: name,
          companyId: (job.data as { companyId?: string }).companyId,
        });
        log.debug('Job iniciado');
        const attempt = {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
          jobId: job.id,
        };
        const result = await runJob(container, name, job.data as JobPayloads[JobName], attempt);
        log.debug({ result }, 'Job concluído');
        return result ?? null;
      },
      { connection, prefix: QUEUE_PREFIX, concurrency: definition.concurrency },
    );
    worker.on('failed', (job, error) => {
      const final = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;
      logger.error({ err: error, jobId: job?.id, job: name, final }, 'Job falhou');
      if (final) {
        void recordError({
          source: 'WORKER',
          code: `${name}.failed`,
          message: error.message,
          companyId: (job?.data as { companyId?: string } | undefined)?.companyId ?? null,
          jobId: job?.id ?? null,
        });
      }
    });
    return worker;
  });

  // Jobs periódicos: o scheduler do BullMQ evita duplicatas entre réplicas do worker.
  const reminders = new Queue(queueNameFor('appointments.reminders'), {
    connection,
    prefix: QUEUE_PREFIX,
  });
  await reminders.upsertJobScheduler(
    'appointments-reminders',
    { every: 15 * 60_000 },
    {
      name: 'appointments.reminders',
      data: {},
      opts: { attempts: JOB_RETRY_POLICY['appointments.reminders'].attempts },
    },
  );
  const retention = new Queue(queueNameFor('maintenance.retention'), {
    connection,
    prefix: QUEUE_PREFIX,
  });
  await retention.upsertJobScheduler(
    'maintenance-retention',
    { pattern: '0 30 3 * * *' },
    { name: 'maintenance.retention', data: {} },
  );
  // Respostas travadas (job perdido por queda de worker/Redis): ver modules/agent/recovery.ts.
  const recovery = new Queue(queueNameFor('agent.recover-stalled'), {
    connection,
    prefix: QUEUE_PREFIX,
  });
  await recovery.upsertJobScheduler(
    'agent-recover-stalled',
    { every: 5 * 60_000 },
    {
      name: 'agent.recover-stalled',
      data: {},
      opts: { attempts: JOB_RETRY_POLICY['agent.recover-stalled'].attempts },
    },
  );

  // Avisos de consumo (70/90/100% do plano): ver modules/usage/alerts.ts.
  const usageAlerts = new Queue(queueNameFor('usage.alerts'), {
    connection,
    prefix: QUEUE_PREFIX,
  });
  await usageAlerts.upsertJobScheduler(
    'usage-alerts',
    { every: 30 * 60_000 },
    {
      name: 'usage.alerts',
      data: {},
      opts: { attempts: JOB_RETRY_POLICY['usage.alerts'].attempts },
    },
  );

  const beat = () => void container.redis?.set(WORKER_HEARTBEAT_KEY, String(Date.now()), 'EX', 120);
  beat();
  const heartbeat = setInterval(beat, 15_000);
  logger.info({ queues: workers.length }, 'Worker pronto');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando worker');
    clearInterval(heartbeat);
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all([
      reminders.close(),
      retention.close(),
      recovery.close(),
      usageAlerts.close(),
      container.queue.close(),
    ]);
    container.redis?.disconnect();
    await disconnectSystemDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
