import {
  AgentEngine,
  composeSystemPrompt,
  decideBufferAction,
  groupInboundMessages,
  userTurn,
  type AgentRunResult,
  type AIImageBlock,
  type HistoryMessage,
} from '@botsaas/ai';
import type {
  AgentRunTrigger,
  AIConfiguration,
  Contact,
  Conversation,
  Prisma,
} from '@botsaas/database';
import { AIProviderError, isOpenAt, type WeeklySchedule } from '@botsaas/shared';
import type { AppContainer } from '../../container';
import type { CompanyScope } from '../../context';
import { getOwnCompany } from '../../lib/company-record';
import { recordError } from '../../lib/error-log';
import { emitDomainEvent } from '../../lib/events';
import { withLock } from '../../lib/locks';
import { notify } from '../../lib/notifications';
import { systemScope } from '../../lib/scope';
import { getEnabledFeatures } from '../features/service';
import { requestHandoff } from '../messaging/handoff';
import { queueOutboundText } from '../messaging/outbound';
import { scheduleAgentReply } from '../messaging/schedule';
import { checkAiAllowance } from '../usage/limits';
import { buildPromptInput, loadHistory } from './context';
import { costFor } from './pricing';
import { agentToolRegistry } from './tools';

export const DEFAULT_HANDOFF_MESSAGE =
  'Vou encaminhar seu atendimento para alguém da nossa equipe. Em breve você será respondido(a).';
export const DEFAULT_FALLBACK_MESSAGE =
  'Tivemos uma instabilidade por aqui. Uma pessoa da nossa equipe vai continuar seu atendimento em breve.';
export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  'Olá! No momento estamos fora do horário de atendimento. Retornaremos assim que possível.';

const LOCK_TTL_MS = 180_000;
const MEDIA_WAIT_MS = 90_000;
const MAX_IMAGES_PER_TURN = 3;
const MAX_IMAGE_BYTES = 3_750_000;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const CALENDAR_TOOLS = new Set([
  'get_available_appointments',
  'create_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'list_contact_appointments',
]);
const CRM_TOOLS = new Set(['update_lead_stage', 'update_lead_qualification']);

const pendingSelect = {
  id: true,
  createdAt: true,
  sender: true,
  type: true,
  text: true,
  payload: true,
  media: {
    select: {
      id: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      transcription: true,
      description: true,
      fileName: true,
      caption: true,
      processingStatus: true,
    },
  },
} satisfies Prisma.MessageSelect;

type PendingMessage = Prisma.MessageGetPayload<{ select: typeof pendingSelect }>;

export interface ToolCallDebug {
  name: string;
  input: unknown;
  ok: boolean;
  durationMs: number;
  result: unknown;
}

export interface AgentTurnOutput {
  agentRunId: string;
  result: AgentRunResult;
  knowledge: { id: string; title: string; score: number }[];
  durationMs: number;
  costUsd: number;
  model: string;
  toolCalls: ToolCallDebug[];
}

async function enabledToolNames(scope: CompanyScope): Promise<string[]> {
  const [configs, features] = await Promise.all([
    scope.db.aIToolConfiguration.findMany({ where: { enabled: true }, select: { toolName: true } }),
    getEnabledFeatures(scope),
  ]);
  return configs
    .map((config) => config.toolName)
    .filter((name) => (CALENDAR_TOOLS.has(name) ? features.has('CALENDAR') : true))
    .filter((name) => (CRM_TOOLS.has(name) ? features.has('CRM') : true));
}

async function loadImages(scope: CompanyScope, pending: PendingMessage[]): Promise<AIImageBlock[]> {
  const images: AIImageBlock[] = [];
  for (const message of pending) {
    for (const media of message.media) {
      if (images.length >= MAX_IMAGES_PER_TURN) return images;
      const mime = media.mimeType?.split(';')[0]?.trim() ?? '';
      if (message.type !== 'IMAGE' || !media.storageKey || !SUPPORTED_IMAGE_TYPES.has(mime))
        continue;
      if ((media.sizeBytes ?? 0) > MAX_IMAGE_BYTES) continue;
      try {
        const data = await scope.container.providers.storage.get(media.storageKey);
        images.push({
          type: 'image',
          mediaType: mime as AIImageBlock['mediaType'],
          data: data.toString('base64'),
        });
      } catch (error) {
        scope.container.logger.warn(
          { err: error, mediaId: media.id },
          'Imagem indisponível para análise',
        );
      }
    }
  }
  return images;
}

function toHistoryMessages(pending: PendingMessage[]): HistoryMessage[] {
  return pending.map((message) => ({ ...message, media: message.media[0] ?? null }));
}

/**
 * Executa UMA rodada do agente para as mensagens pendentes: monta contexto, chama o modelo,
 * executa tools e registra AgentRun + consumo. Não envia mensagens (quem chama decide).
 * Lança o erro do provedor para permitir retry.
 */
export async function executeAgentTurn(
  scope: CompanyScope,
  input: {
    conversation: Conversation & { contact: Contact };
    config: AIConfiguration;
    pending: PendingMessage[];
    trigger: AgentRunTrigger;
    dryRun: boolean;
  },
): Promise<AgentTurnOutput> {
  const { conversation, config, pending } = input;
  const { container } = scope;
  const model = config.model ?? container.env.AI_DEFAULT_MODEL;
  const currentText = groupInboundMessages(toHistoryMessages(pending));

  const [{ prompt, knowledge }, history, images, toolNames] = await Promise.all([
    buildPromptInput({ scope, conversation, config, pending, currentText, isTest: input.dryRun }),
    loadHistory(
      scope,
      conversation.id,
      config,
      pending.map((message) => message.id),
    ),
    loadImages(scope, pending),
    enabledToolNames(scope),
  ]);

  const agentRun = await scope.db.agentRun.create({
    data: {
      companyId: scope.companyId,
      conversationId: conversation.id,
      trigger: input.trigger,
      model,
      provider: container.providers.ai.name,
      inputMessageIds: pending.map((message) => message.id),
    },
  });

  const toolCalls: ToolCallDebug[] = [];
  const started = Date.now();
  let result: AgentRunResult;
  try {
    result = await AgentEngine.run({
      provider: container.providers.ai,
      model,
      system: composeSystemPrompt(prompt),
      messages: [...history.messages, userTurn(currentText || '[mensagem sem texto]', images)],
      tools: agentToolRegistry.resolve(toolNames),
      toolContext: { scope, conversationId: conversation.id, contactId: conversation.contactId },
      maxIterations: config.maxToolIterations,
      maxOutputTokens: config.maxOutputTokens,
      effort:
        (['low', 'medium', 'high'] as const).find((level) => level === config.effort) ?? 'medium',
      meta: { dryRun: input.dryRun },
      onToolCall: (call) =>
        toolCalls.push({
          name: call.name,
          input: call.input,
          ok: call.ok,
          durationMs: call.durationMs,
          result: call.result.ok ? call.result.data : { error: call.result.error },
        }),
    });
  } catch (error) {
    await scope.db.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: 'FAILED',
        errorCode: error instanceof AIProviderError ? error.code : 'internal_error',
        errorMessage: (error instanceof Error ? error.message : 'erro').slice(0, 500),
        durationMs: Date.now() - started,
        finishedAt: new Date(),
        toolCalls: toolCalls.map(({ name, ok, durationMs }) => ({
          name,
          ok,
          durationMs,
        })) as Prisma.InputJsonValue,
      },
    });
    throw error;
  }

  const durationMs = Date.now() - started;
  const servedModel = result.modelsUsed[0] ?? model;
  const costUsd = await costFor(servedModel, result.usage);
  const failedOutcome =
    result.outcome === 'refused' ||
    result.outcome === 'max_iterations' ||
    (result.outcome === 'truncated' && !result.text);
  const knowledgeHits = knowledge.map((hit) => ({
    id: hit.id,
    title: hit.title,
    score: Math.round(hit.score * 1000) / 1000,
  }));

  await scope.db.agentRun.update({
    where: { id: agentRun.id },
    data: {
      status: failedOutcome ? 'FAILED' : 'SUCCEEDED',
      model: servedModel,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      iterations: result.iterations,
      toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
      knowledgeHits: knowledgeHits as Prisma.InputJsonValue,
      stopReason: result.stopReason,
      durationMs,
      estimatedCostUsd: costUsd,
      errorCode: failedOutcome ? result.outcome : null,
      finishedAt: new Date(),
    },
  });
  await scope.db.usageRecord.create({
    data: {
      companyId: scope.companyId,
      kind: 'AI_CALL',
      model: servedModel,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      costUsd,
      agentRunId: agentRun.id,
      conversationId: conversation.id,
      isTest: input.dryRun,
    },
  });

  return {
    agentRunId: agentRun.id,
    result,
    knowledge: knowledgeHits,
    durationMs,
    costUsd,
    model: servedModel,
    toolCalls,
  };
}

async function markHandled(scope: CompanyScope, messageIds: string[], agentRunId?: string) {
  if (messageIds.length === 0) return;
  await scope.db.message.updateMany({
    where: { id: { in: messageIds } },
    data: { agentHandledAt: new Date(), ...(agentRunId ? { agentRunId } : {}) },
  });
}

/** Comportamento quando a IA não pode ou não conseguiu responder (limite, falha, recusa). */
async function applyFallback(
  scope: CompanyScope,
  conversationId: string,
  config: AIConfiguration,
  reason: string,
) {
  if (config.fallbackBehavior === 'SEND_FALLBACK_MESSAGE') {
    await queueOutboundText(scope, {
      conversationId,
      text: config.fallbackMessage ?? DEFAULT_FALLBACK_MESSAGE,
      sender: 'SYSTEM',
    }).catch(() => undefined);
  }
  if (config.fallbackBehavior === 'HANDOFF_TO_HUMAN') {
    if (config.handoffMessage) {
      await queueOutboundText(scope, {
        conversationId,
        text: config.handoffMessage,
        sender: 'SYSTEM',
      }).catch(() => undefined);
    }
    await requestHandoff(scope, conversationId, { requestedBy: 'SYSTEM', reason });
    return;
  }
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: { needsAttention: true, attentionReason: reason.slice(0, 300) },
  });
}

export type AgentJobOutcome =
  'responded' | 'handoff' | 'fallback' | 'rescheduled' | 'skipped' | 'locked';

/**
 * Processa o job `agent.reply` de uma conversa (debounce, limites, horário, agente, envio).
 * Idempotente: só considera mensagens de entrada ainda não tratadas.
 */
export async function runConversationTurn(
  scope: CompanyScope,
  conversationId: string,
  attempt: { attemptsMade: number; maxAttempts: number; jobId?: string },
): Promise<AgentJobOutcome> {
  const conversation = await scope.db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conversation || conversation.mode !== 'AI' || conversation.channel !== 'WHATSAPP')
    return 'skipped';
  const config = await scope.db.aIConfiguration.findFirst();
  if (!config?.enabled) return 'skipped';

  const pending = await scope.db.message.findMany({
    where: { conversationId, direction: 'INBOUND', agentHandledAt: null },
    orderBy: { createdAt: 'asc' },
    select: pendingSelect,
    take: 30,
  });
  if (pending.length === 0) return 'skipped';

  const now = new Date();
  const decision = decideBufferAction({ pending, bufferSeconds: config.messageBufferSeconds, now });
  if (decision.action === 'wait') {
    await scheduleAgentReply(scope, conversationId, decision.delayMs);
    return 'rescheduled';
  }
  const mediaProcessing = pending.some((message) =>
    message.media.some(
      (media) =>
        (media.processingStatus === 'PENDING' || media.processingStatus === 'DOWNLOADED') &&
        now.getTime() - message.createdAt.getTime() < MEDIA_WAIT_MS,
    ),
  );
  if (mediaProcessing) {
    await scheduleAgentReply(scope, conversationId, 2_000);
    return 'rescheduled';
  }
  const pendingIds = pending.map((message) => message.id);

  const allowance = await checkAiAllowance(scope, now);
  if (!allowance.allowed) {
    await notify(scope, {
      type: 'USAGE_LIMIT_REACHED',
      severity: 'CRITICAL',
      title: 'Atendimento automático pausado',
      body: allowance.reason,
    });
    await applyFallback(
      scope,
      conversationId,
      { ...config, fallbackBehavior: 'HANDOFF_TO_HUMAN' },
      allowance.reason ?? 'Limite de uso atingido',
    );
    await markHandled(scope, pendingIds);
    return 'fallback';
  }

  if (!config.respondOutsideHours) {
    const company = await getOwnCompany(scope);
    const holidays = await scope.db.holiday.findMany();
    if (
      isOpenAt((company.businessHours ?? []) as WeeklySchedule, holidays, now, company.timezone) ===
      false
    ) {
      const text = config.outOfHoursMessage ?? DEFAULT_OUT_OF_HOURS_MESSAGE;
      const recent = await scope.db.message.findFirst({
        where: {
          conversationId,
          direction: 'OUTBOUND',
          text,
          createdAt: { gte: new Date(now.getTime() - 12 * 3600_000) },
        },
      });
      if (!recent) await queueOutboundText(scope, { conversationId, text, sender: 'SYSTEM' });
      await markHandled(scope, pendingIds);
      return 'fallback';
    }
  }

  let output: AgentTurnOutput;
  try {
    output = await executeAgentTurn(scope, {
      conversation,
      config,
      pending,
      trigger: 'INBOUND_MESSAGE',
      dryRun: false,
    });
  } catch (error) {
    const retryable = error instanceof AIProviderError ? error.retryable : true;
    if (retryable && attempt.attemptsMade + 1 < attempt.maxAttempts) throw error;
    // Falha definitiva: não inventamos resposta. Marca a conversa e aciona o fallback.
    const reason = error instanceof Error ? error.message : 'Falha no agente';
    await scope.db.conversation.update({
      where: { id: conversationId },
      data: { aiFailureCount: { increment: 1 } },
    });
    await recordError({
      source: 'AI',
      code: error instanceof AIProviderError ? error.code : 'agent_failed',
      message: reason,
      companyId: scope.companyId,
      conversationId,
      jobId: attempt.jobId,
    });
    await notify(scope, {
      type: 'AGENT_FAILED',
      severity: 'CRITICAL',
      title: 'A IA não conseguiu responder',
      body: reason,
      link: `/app/conversations/${conversationId}`,
    });
    await emitDomainEvent(scope, 'agent.failed', { conversationId, reason });
    await applyFallback(scope, conversationId, config, 'Falha do atendente virtual');
    await markHandled(scope, pendingIds);
    return 'fallback';
  }

  const { result } = output;
  if (result.outcome === 'refused' || result.outcome === 'max_iterations' || !result.text.trim()) {
    if (result.effects.handoff) {
      await queueOutboundText(scope, {
        conversationId,
        text: config.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE,
        sender: 'AI',
        agentRunId: output.agentRunId,
      });
      await requestHandoff(scope, conversationId, {
        requestedBy: 'AI',
        reason: result.effects.handoff.reason,
      });
      await markHandled(scope, pendingIds, output.agentRunId);
      return 'handoff';
    }
    await applyFallback(scope, conversationId, config, `Agente sem resposta (${result.outcome})`);
    await markHandled(scope, pendingIds, output.agentRunId);
    return 'fallback';
  }

  await queueOutboundText(scope, {
    conversationId,
    text: result.text.trim(),
    sender: 'AI',
    agentRunId: output.agentRunId,
  });
  await markHandled(scope, pendingIds, output.agentRunId);
  await scope.db.conversation.update({
    where: { id: conversationId },
    data: { aiFailureCount: 0 },
  });

  if (result.effects.handoff) {
    await requestHandoff(scope, conversationId, {
      requestedBy: 'AI',
      reason: result.effects.handoff.reason,
    });
    return 'handoff';
  }

  // Mensagens que chegaram durante o processamento serão respondidas na próxima rodada.
  const newer = await scope.db.message.count({
    where: { conversationId, direction: 'INBOUND', agentHandledAt: null },
  });
  if (newer > 0) await scheduleAgentReply(scope, conversationId);
  await maybeScheduleSummary(scope, conversationId, config);
  return 'responded';
}

async function maybeScheduleSummary(
  scope: CompanyScope,
  conversationId: string,
  config: AIConfiguration,
) {
  const summary = await scope.db.conversationSummary.findFirst({
    where: { conversationId },
    select: { coveredUntil: true },
  });
  const count = await scope.db.message.count({
    where: {
      conversationId,
      sender: { not: 'SYSTEM' },
      ...(summary ? { createdAt: { gt: summary.coveredUntil } } : {}),
    },
  });
  if (count > config.summaryThreshold) {
    await scope.container.queue.enqueue(
      'conversation.summarize',
      { companyId: scope.companyId, conversationId, reason: 'threshold' },
      { jobId: `summary-${conversationId}-${Math.floor(count / 10)}` },
    );
  }
}

/** Entrada do job `agent.reply`, com lock por conversa para nunca responder em paralelo. */
export async function handleAgentReplyJob(
  container: AppContainer,
  payload: { companyId: string; conversationId: string },
  attempt: { attemptsMade: number; maxAttempts: number; jobId?: string },
): Promise<AgentJobOutcome> {
  const scope = systemScope(container, payload.companyId, {
    type: 'AI',
    label: 'Atendente virtual',
  });
  const outcome = await withLock(
    container.redis,
    `conversation:${payload.conversationId}`,
    LOCK_TTL_MS,
    () => runConversationTurn(scope, payload.conversationId, attempt),
  );
  if (outcome === null) {
    await scheduleAgentReply(scope, payload.conversationId, 3_000);
    return 'locked';
  }
  return outcome;
}
