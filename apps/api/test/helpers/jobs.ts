import { runJob } from '../../src/jobs/processors';
import type { JobName } from '../../src/queues/types';
import type { TestHarness } from './harness';

/**
 * Executa os jobs enfileirados (fila em memória) como o worker faria, repetindo até esvaziar
 * ou atingir `maxRounds`. `only` limita os tipos processados; os demais ficam na fila.
 */
export async function drainJobs(
  harness: TestHarness,
  options: { only?: JobName[]; skip?: JobName[]; maxRounds?: number } = {},
) {
  const processed: JobName[] = [];
  for (let round = 0; round < (options.maxRounds ?? 10); round += 1) {
    const runnable = harness.queue.jobs.filter(
      (job) =>
        (!options.only || options.only.includes(job.name)) && !options.skip?.includes(job.name),
    );
    if (runnable.length === 0) break;
    harness.queue.jobs = harness.queue.jobs.filter((job) => !runnable.includes(job));
    for (const job of runnable) {
      await runJob(harness.container, job.name, job.payload);
      processed.push(job.name);
    }
  }
  return processed;
}

export function countJobs(harness: TestHarness, name: JobName): number {
  return harness.queue.jobs.filter((job) => job.name === name).length;
}
