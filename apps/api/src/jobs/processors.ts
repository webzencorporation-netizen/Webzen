import type { AppContainer } from '../container';
import { systemScope } from '../lib/scope';
import { checkUsageAlerts } from '../modules/usage/alerts';
import { recoverStalledReplies } from '../modules/agent/recovery';
import { handleAgentReplyJob } from '../modules/agent/runner';
import { summarizeConversation } from '../modules/agent/summary';
import { dispatchDomainEvent } from '../modules/automations/engine';
import { processCalendarSync } from '../modules/calendar/service';
import { processKnowledgeDocument } from '../modules/company/knowledge/documents';
import { emitAppointmentReminders, runRetention } from '../modules/maintenance/service';
import { processMediaAsset } from '../modules/messaging/media';
import { processOutboundMessage } from '../modules/messaging/outbound';
import { processWebhookEvent } from '../modules/webhooks/service';
import type { JobName, JobPayloads } from '../queues/types';

export interface JobAttempt {
  attemptsMade: number;
  maxAttempts: number;
  jobId?: string;
}

type Processor<N extends JobName> = (
  container: AppContainer,
  payload: JobPayloads[N],
  attempt: JobAttempt,
) => Promise<unknown>;

/** Processadores de todos os jobs (usados pelo worker e pelos testes). */
export const JOB_PROCESSORS: { [N in JobName]: { concurrency: number; run: Processor<N> } } = {
  'webhook.process': {
    concurrency: 10,
    run: (c, p, a) => processWebhookEvent(c, p.webhookEventId, a),
  },
  'agent.reply': { concurrency: 8, run: (c, p, a) => handleAgentReplyJob(c, p, a) },
  'message.send': {
    concurrency: 10,
    run: (c, p, a) => processOutboundMessage(systemScope(c, p.companyId), p.messageId, a),
  },
  'media.process': {
    concurrency: 4,
    run: (c, p, a) => processMediaAsset(systemScope(c, p.companyId), p.mediaAssetId, a),
  },
  'conversation.summarize': {
    concurrency: 2,
    run: (c, p) =>
      summarizeConversation(
        systemScope(c, p.companyId, { type: 'AI', label: 'Resumo' }),
        p.conversationId,
        p.reason,
      ),
  },
  'domain-event.dispatch': { concurrency: 5, run: (c, p) => dispatchDomainEvent(c, p) },
  'knowledge.process-document': {
    concurrency: 2,
    run: (c, p) => processKnowledgeDocument(systemScope(c, p.companyId), p.documentId),
  },
  'calendar.sync': {
    concurrency: 3,
    run: (c, p) => processCalendarSync(systemScope(c, p.companyId), p.appointmentId, p.action),
  },
  'appointments.reminders': { concurrency: 1, run: (c) => emitAppointmentReminders(c) },
  'maintenance.retention': { concurrency: 1, run: (c) => runRetention(c) },
  'agent.recover-stalled': { concurrency: 1, run: (c) => recoverStalledReplies(c) },
  'usage.alerts': { concurrency: 1, run: (c) => checkUsageAlerts(c) },
};

export function runJob<N extends JobName>(
  container: AppContainer,
  name: N,
  payload: JobPayloads[N],
  attempt: JobAttempt = { attemptsMade: 0, maxAttempts: 1 },
) {
  const processor = JOB_PROCESSORS[name] as { run: Processor<N> };
  return processor.run(container, payload, attempt);
}
