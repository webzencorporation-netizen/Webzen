import { Queue, type ConnectionOptions } from 'bullmq';
import {
  JOB_NAMES,
  JOB_RETRY_POLICY,
  type EnqueueOptions,
  type JobName,
  type JobPayloads,
  type JobQueue,
} from './types';

export const QUEUE_PREFIX = 'botsaas';

export function queueNameFor(job: JobName): string {
  return job.replaceAll('.', '-');
}

export function redisConnectionFromUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<JobName, Queue>();

  constructor(private readonly connection: ConnectionOptions) {}

  private queue(name: JobName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(queueNameFor(name), { connection: this.connection, prefix: QUEUE_PREFIX });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<void> {
    const policy = JOB_RETRY_POLICY[name];
    await this.queue(name).add(name, payload, {
      jobId: options.jobId,
      delay: options.delayMs,
      attempts: policy.attempts,
      backoff: policy.backoffMs > 0 ? { type: 'exponential', delay: policy.backoffMs } : undefined,
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
      deduplication: options.debounceId
        ? { id: options.debounceId, ttl: options.delayMs ?? 1, extend: true, replace: true }
        : undefined,
    });
  }

  /** Estatísticas simples para o painel de saúde da plataforma. */
  async stats() {
    const result: Record<string, Record<string, number>> = {};
    for (const name of JOB_NAMES) {
      result[name] = await this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
    }
    return result;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}
