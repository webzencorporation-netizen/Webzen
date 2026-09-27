import type { Env } from '@botsaas/config';
import { AnthropicProvider, MockAIProvider, type AIProvider } from '@botsaas/ai';
import {
  DisabledSpeechToText,
  LocalObjectStorage,
  MockSpeechToText,
  OpenAICompatibleSpeechToText,
  S3ObjectStorage,
  type ObjectStorageProvider,
  type SpeechToTextProvider,
} from '@botsaas/integrations';
import { CloudApiProvider, MockMessagingProvider, type MessagingProvider } from '@botsaas/whatsapp';
import type { Logger } from './lib/logger';

/** Providers externos ativos. Produção recusa mocks na validação do env (packages/config). */
export interface Providers {
  ai: AIProvider;
  messaging: MessagingProvider;
  storage: ObjectStorageProvider;
  speechToText: SpeechToTextProvider;
}

export function createProviders(env: Env, logger: Logger): Providers {
  const ai: AIProvider =
    env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY
      ? new AnthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY,
          timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
          refusalFallback: env.AI_REFUSAL_FALLBACK,
        })
      : new MockAIProvider();

  const messaging: MessagingProvider =
    env.WHATSAPP_PROVIDER === 'cloud'
      ? new CloudApiProvider({
          baseUrl: env.WHATSAPP_GRAPH_API_BASE_URL,
          apiVersion: env.WHATSAPP_GRAPH_API_VERSION,
        })
      : new MockMessagingProvider();

  const storage: ObjectStorageProvider =
    env.STORAGE_PROVIDER === 's3' && env.S3_BUCKET
      ? new S3ObjectStorage({
          bucket: env.S3_BUCKET,
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new LocalObjectStorage(env.STORAGE_LOCAL_DIR);

  let speechToText: SpeechToTextProvider = new DisabledSpeechToText();
  if (env.STT_PROVIDER === 'mock') speechToText = new MockSpeechToText();
  if (env.STT_PROVIDER === 'openai-compatible' && env.STT_API_URL && env.STT_API_KEY) {
    speechToText = new OpenAICompatibleSpeechToText({
      url: env.STT_API_URL,
      apiKey: env.STT_API_KEY,
      model: env.STT_MODEL,
    });
  }

  const summary = {
    ai: ai.name,
    messaging: messaging.name,
    storage: storage.name,
    speechToText: speechToText.name,
  };
  const mocks = Object.entries(summary).filter(([, name]) => name === 'mock' || name === 'local');
  if (mocks.length > 0) {
    logger.warn(
      { providers: summary },
      'Providers de desenvolvimento ativos (não use em produção)',
    );
  } else {
    logger.info({ providers: summary }, 'Providers ativos');
  }
  return { ai, messaging, storage, speechToText };
}
