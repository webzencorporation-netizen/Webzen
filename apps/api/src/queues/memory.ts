import type { EnqueueOptions, JobName, JobPayloads, JobQueue } from './types';

export interface RecordedJob<N extends JobName = JobName> {
  name: N;
  payload: JobPayloads[N];
  options: EnqueueOptions;
}

/**
 * Fila em memória para TESTES. Registra os jobs; o teste decide quando processá-los.
 * Nunca usada em produção (o container recusa).
 */
export class InMemoryJobQueue implements JobQueue {
  jobs: RecordedJob[] = [];

  async enqueue<N extends JobName>(name: N, payload: JobPayloads[N], options: EnqueueOptions = {}): Promise<void> {
    if (options.jobId && this.jobs.some((job) => job.options.jobId === options.jobId)) return;
    if (options.debounceId) {
      this.jobs = this.jobs.filter((job) => job.options.debounceId !== options.debounceId);
    }
    this.jobs.push({ name, payload, options } as RecordedJob);
  }

  take<N extends JobName>(name: N): RecordedJob<N>[] {
    const taken = this.jobs.filter((job): job is RecordedJob<N> => job.name === name);
    this.jobs = this.jobs.filter((job) => job.name !== name);
    return taken;
  }

  clear(): void {
    this.jobs = [];
  }

  async close(): Promise<void> {
    this.jobs = [];
  }
}
