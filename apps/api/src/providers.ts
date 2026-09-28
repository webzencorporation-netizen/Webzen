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

/** Falha de composição: um provider real foi pedido mas não pode ser construído. */
function missing(provider: string, variable: string): never {
  throw new Error(`${provider} exige ${variable}; recusando substituir por simulação.`);
}

export function createProviders(env: Env, logger: Logger): Providers {
  // `validateEnvRules` já recusa estes casos; aqui eles falham em vez de degradar em silêncio
  // caso um env chegue sem a validação cruzada.
  const ai: AIProvider =
    env.AI_PROVIDER === 'anthropic'
      ? new AnthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY ?? missing('AI_PROVIDER=anthropic', 'ANTHROPIC_API_KEY'),
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
    env.STORAGE_PROVIDER === 's3'
      ? new S3ObjectStorage({
          bucket: env.S3_BUCKET ?? missing('STORAGE_PROVIDER=s3', 'S3_BUCKET'),
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new LocalObjectStorage(env.STORAGE_LOCAL_DIR);

  let speechToText: SpeechToTextProvider = new DisabledSpeechToText();
  if (env.STT_PROVIDER === 'mock') speechToText = new MockSpeechToText();
  if (env.STT_PROVIDER === 'openai-compatible') {
    speechToText = new OpenAICompatibleSpeechToText({
      url: env.STT_API_URL ?? missing('STT_PROVIDER=openai-compatible', 'STT_API_URL'),
      apiKey: env.STT_API_KEY ?? missing('STT_PROVIDER=openai-compatible', 'STT_API_KEY'),
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
  if (mocks.length > 0 && env.NODE_ENV === 'production') {
    throw new Error(
      `Providers simulados/locais recusados em produção: ${mocks.map(([kind, name]) => `${kind}=${name}`).join(', ')}.`,
    );
  }
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
