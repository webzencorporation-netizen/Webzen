import { buildSummaryInput, SUMMARY_SYSTEM_PROMPT, type HistoryMessage } from '@botsaas/ai';
import type { CompanyScope } from '../../context';
import { costFor } from './pricing';

const MAX_MESSAGES_PER_SUMMARY = 200;

/**
 * Atualiza o resumo da conversa (reduz tokens mantendo contexto). Em `handoff_return`, grava
 * também o resumo do atendimento humano no registro de handoff.
 */
export async function summarizeConversation(
  scope: CompanyScope,
  conversationId: string,
  reason: 'threshold' | 'handoff_return',
) {
  const existing = await scope.db.conversationSummary.findFirst({ where: { conversationId } });
  const rows = await scope.db.message.findMany({
    where: { conversationId, ...(existing ? { createdAt: { gt: existing.coveredUntil } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: MAX_MESSAGES_PER_SUMMARY,
    select: {
      sender: true,
      type: true,
      text: true,
      createdAt: true,
      payload: true,
      media: { select: { transcription: true, description: true, fileName: true, caption: true } },
    },
  });
  if (rows.length === 0) return null;
  const messages: HistoryMessage[] = rows.map((row) => ({ ...row, media: row.media[0] ?? null }));
  const last = rows.at(-1);
  if (!last) return null;

  const { container } = scope;
  const config = await scope.db.aIConfiguration.findFirst({ select: { model: true } });
  const model = container.env.AI_SUMMARY_MODEL ?? config?.model ?? container.env.AI_DEFAULT_MODEL;
  const response = await container.providers.ai.complete({
    model,
    system: [{ text: SUMMARY_SYSTEM_PROMPT }],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: buildSummaryInput(existing?.summary ?? null, messages) }],
      },
    ],
    tools: [],
    maxOutputTokens: 2048,
    effort: 'low',
  });
  const summary = response.text.trim();
  if (!summary) return null;

  await scope.db.conversationSummary.upsert({
    where: { conversationId },
    create: {
      companyId: scope.companyId,
      conversationId,
      summary,
      coveredUntil: last.createdAt,
      messagesCovered: rows.length,
    },
    update: { summary, coveredUntil: last.createdAt, messagesCovered: { increment: rows.length } },
  });
  await scope.db.usageRecord.create({
    data: {
      companyId: scope.companyId,
      kind: 'AI_CALL',
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      costUsd: await costFor(response.model, response.usage),
      conversationId,
    },
  });

  if (reason === 'handoff_return') {
    const handoff = await scope.db.handoff.findFirst({
      where: { conversationId, resolvedAt: { not: null } },
      orderBy: { resolvedAt: 'desc' },
    });
    if (handoff)
      await scope.db.handoff.update({
        where: { id: handoff.id },
        data: { resolutionSummary: summary.slice(0, 2000) },
      });
  }
  return summary;
}
