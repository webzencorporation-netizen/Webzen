/**
 * Catálogo de jobs. Cada job tem uma fila BullMQ própria (concorrência e retries independentes).
 * Payloads carregam apenas IDs — o processador sempre relê o estado do banco (idempotência).
 */
export interface JobPayloads {
  'webhook.process': { webhookEventId: string };
  'agent.reply': { companyId: string; conversationId: string };
  'message.send': { companyId: string; messageId: string };
  'media.process': { companyId: string; mediaAssetId: string };
  'conversation.summarize': {
    companyId: string;
    conversationId: string;
    reason: 'threshold' | 'handoff_return';
  };
  'domain-event.dispatch': { companyId: string; eventId: string };
  'knowledge.process-document': { companyId: string; documentId: string };
  'calendar.sync': {
    companyId: string;
    appointmentId: string;
    action: 'create' | 'update' | 'delete';
  };
  'appointments.reminders': Record<string, never>;
  'maintenance.retention': Record<string, never>;
  'agent.recover-stalled': Record<string, never>;
  'usage.alerts': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export const JOB_NAMES = [
  'webhook.process',
  'agent.reply',
  'message.send',
  'media.process',
  'conversation.summarize',
  'domain-event.dispatch',
  'knowledge.process-document',
  'calendar.sync',
  'appointments.reminders',
  'maintenance.retention',
  'agent.recover-stalled',
  'usage.alerts',
] as const satisfies readonly JobName[];

export interface EnqueueOptions {
  /** Atraso em ms antes de o job ficar disponível. */
  delayMs?: number;
  /** ID determinístico: um segundo enqueue com o mesmo ID é ignorado (idempotência). */
  jobId?: string;
  /**
   * Debounce: jobs com o mesmo `debounceId` substituem o anterior ainda atrasado e
   * reiniciam o atraso. Usado no agrupamento de mensagens.
   */
  debounceId?: string;
}

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<void>;
  close(): Promise<void>;
}

/** Política padrão de retry: tentativas limitadas com backoff exponencial (nunca infinito). */
export const JOB_RETRY_POLICY: Record<JobName, { attempts: number; backoffMs: number }> = {
  'webhook.process': { attempts: 5, backoffMs: 2_000 },
  'agent.reply': { attempts: 3, backoffMs: 5_000 },
  'message.send': { attempts: 4, backoffMs: 3_000 },
  'media.process': { attempts: 4, backoffMs: 5_000 },
  'conversation.summarize': { attempts: 3, backoffMs: 10_000 },
  'domain-event.dispatch': { attempts: 5, backoffMs: 2_000 },
  'knowledge.process-document': { attempts: 3, backoffMs: 10_000 },
  'calendar.sync': { attempts: 5, backoffMs: 10_000 },
  'appointments.reminders': { attempts: 1, backoffMs: 0 },
  'maintenance.retention': { attempts: 1, backoffMs: 0 },
  'agent.recover-stalled': { attempts: 1, backoffMs: 0 },
  'usage.alerts': { attempts: 1, backoffMs: 0 },
};
