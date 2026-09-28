import { createHash, randomUUID } from 'node:crypto';
import { buildObjectKey } from '@botsaas/integrations';
import { AppError } from '@botsaas/shared';
import type { CompanyScope } from '../../context';
import { resolveCredentials } from './accounts';
import { scheduleAgentReply } from './schedule';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

async function schedulePendingReply(scope: CompanyScope, messageId: string | null) {
  if (!messageId) return;
  const message = await scope.db.message.findFirst({
    where: { id: messageId, agentHandledAt: null },
    select: { conversationId: true },
  });
  if (message) await scheduleAgentReply(scope, message.conversationId, 500);
}

export function extensionFor(mimeType: string | null | undefined): string {
  const base = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS[base] ?? 'bin';
}

/**
 * Job `media.process`: copia a mídia da URL temporária da Meta para o nosso storage,
 * transcreve áudios (se configurado) e libera o agente para responder.
 */
export async function processMediaAsset(
  scope: CompanyScope,
  mediaAssetId: string,
  attempt: { attemptsMade: number; maxAttempts: number } = { attemptsMade: 0, maxAttempts: 1 },
) {
  const media = await scope.db.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    include: { message: { select: { conversationId: true } } },
  });
  if (!media) return;
  if (
    media.processingStatus === 'PROCESSED' ||
    media.processingStatus === 'SKIPPED' ||
    media.processingStatus === 'FAILED'
  ) {
    // O processamento pode ter terminado antes de uma falha de Redis. Recuperar
    // o agendamento sem baixar/transcrever novamente uma mídia já finalizada.
    await schedulePendingReply(scope, media.messageId);
    return;
  }
  const { container } = scope;

  try {
    if (!media.storageKey && media.externalMediaId) {
      const conversation = media.message
        ? await scope.db.conversation.findUnique({
            where: { id: media.message.conversationId },
            select: { whatsappAccountId: true },
          })
        : null;
      const { credentials } = await resolveCredentials(scope, conversation?.whatsappAccountId);
      const info = await container.providers.messaging.getMediaInfo(
        credentials,
        media.externalMediaId,
      );
      if (info.fileSize && info.fileSize > MAX_MEDIA_BYTES)
        throw new Error('Mídia excede o tamanho máximo permitido.');
      const data = await container.providers.messaging.downloadMedia(credentials, info.url);
      if (data.length > MAX_MEDIA_BYTES)
        throw new Error('Mídia excede o tamanho máximo permitido.');
      const mimeType = media.mimeType ?? info.mimeType;
      const key = buildObjectKey(
        scope.companyId,
        'media',
        `${randomUUID()}.${extensionFor(mimeType)}`,
      );
      await container.providers.storage.put(key, data, { contentType: mimeType });
      await scope.db.mediaAsset.update({
        where: { id: media.id },
        data: {
          storageKey: key,
          mimeType,
          sizeBytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
          processingStatus: 'DOWNLOADED',
        },
      });
      media.storageKey = key;
      media.mimeType = mimeType;
    }

    if (media.kind === 'AUDIO') {
      const stt = container.providers.speechToText;
      if (stt.enabled && media.storageKey) {
        const audio = await container.providers.storage.get(media.storageKey);
        const transcription = await stt.transcribe(audio, {
          mimeType: media.mimeType ?? 'audio/ogg',
          language: 'pt',
        });
        await scope.db.mediaAsset.update({
          where: { id: media.id },
          data: {
            transcription: transcription.text,
            durationSeconds: transcription.durationSeconds ?? null,
            processingStatus: 'PROCESSED',
          },
        });
      } else {
        await scope.db.mediaAsset.update({
          where: { id: media.id },
          data: { processingStatus: 'SKIPPED', processingError: 'Transcrição não configurada' },
        });
      }
    } else {
      await scope.db.mediaAsset.update({
        where: { id: media.id },
        data: { processingStatus: 'PROCESSED' },
      });
    }
  } catch (error) {
    const retryable = error instanceof AppError ? error.retryable : true;
    if (retryable && attempt.attemptsMade + 1 < attempt.maxAttempts) throw error;
    await scope.db.mediaAsset.update({
      where: { id: media.id },
      data: {
        processingStatus: 'FAILED',
        processingError: (error instanceof Error ? error.message : 'erro').slice(0, 300),
      },
    });
  }

  await schedulePendingReply(scope, media.messageId);
}
