import { clampBufferSeconds } from '@botsaas/ai';
import type { CompanyScope } from '../../context';

/**
 * Agenda a resposta da IA com debounce: cada nova mensagem reinicia a espera de
 * `messageBufferSeconds`. O processador reconfere tudo no banco antes de responder.
 */
export async function scheduleAgentReply(
  scope: CompanyScope,
  conversationId: string,
  delayOverrideMs?: number,
): Promise<boolean> {
  const [conversation, config] = await Promise.all([
    scope.db.conversation.findUnique({
      where: { id: conversationId },
      select: { mode: true, channel: true },
    }),
    scope.db.aIConfiguration.findFirst({ select: { enabled: true, messageBufferSeconds: true } }),
  ]);
  if (!conversation || conversation.mode !== 'AI') return false;
  if (!config?.enabled && conversation.channel !== 'TEST') return false;
  const delayMs = delayOverrideMs ?? clampBufferSeconds(config?.messageBufferSeconds ?? 4) * 1000;
  await scope.container.queue.enqueue(
    'agent.reply',
    { companyId: scope.companyId, conversationId },
    { delayMs, debounceId: `agent-${conversationId}` },
  );
  return true;
}
