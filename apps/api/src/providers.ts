import type { Env } from '@botsaas/config';
import {
  AnthropicProvider,
  GeminiProvider,
  MetaModelProvider,
  MockAIProvider,
  type AIProvider,
} from '@botsaas/ai';
import {
  DisabledSpeechToText,
  LocalObjectStorage,
  LogEmailSender,
  BrevoEmailSender,
  SmtpEmailSender,
  type EmailSender,
  MockSpeechToText,
  OpenAICompatibleSpeechToText,
  S3ObjectStorage,
  type ObjectStorageProvider,
  type SpeechToTextProvider,
} from '@botsaas/integrations';
import { CloudApiProvider, MockMessagingProvider, type MessagingProvider } from '@botsaas/whatsapp';
import type { Logger } from './lib/logger';
import { MockBillingProvider } from './modules/billing/mock';
import type { BillingProvider } from './modules/billing/provider';
import { StripeBillingProvider } from './modules/billing/stripe';

/** Providers externos ativos. Produção recusa mocks na validação do env (packages/config). */
export interface Providers {
  ai: AIProvider;
  messaging: MessagingProvider;
  storage: ObjectStorageProvider;
  speechToText: SpeechToTextProvider;
  email: EmailSender;
  /** Nulo = cobrança desligada (BILLING_PROVIDER=none). */
  billing: BillingProvider | null;
}

/** Falha de composição: um provider real foi pedido mas não pode ser construído. */
function missing(provider: string, variable: string): never {
  throw new Error(`${provider} exige ${variable}; recusando substituir por simulação.`);
}

export function createProviders(env: Env, logger: Logger): Providers {
  // `validateEnvRules` já recusa estes casos; aqui eles falham em vez de degradar em silêncio
  // caso um env chegue sem a validação cruzada.
  let ai: AIProvider = new MockAIProvider();
  if (env.AI_PROVIDER === 'anthropic') {
    ai = new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY ?? missing('AI_PROVIDER=anthropic', 'ANTHROPIC_API_KEY'),
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      refusalFallback: env.AI_REFUSAL_FALLBACK,
    });
  }
  if (env.AI_PROVIDER === 'gemini') {
    ai = new GeminiProvider({
      apiKey: env.GEMINI_API_KEY ?? missing('AI_PROVIDER=gemini', 'GEMINI_API_KEY'),
      baseURL: env.GEMINI_API_BASE_URL,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    });
  }
  if (env.AI_PROVIDER === 'meta') {
    ai = new MetaModelProvider({
      apiKey: env.META_MODEL_API_KEY ?? missing('AI_PROVIDER=meta', 'META_MODEL_API_KEY'),
      baseURL: env.META_MODEL_API_BASE_URL,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    });
  }

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

  const email: EmailSender =
    env.EMAIL_PROVIDER === 'smtp'
      ? new SmtpEmailSender({
          host: env.SMTP_HOST ?? missing('EMAIL_PROVIDER=smtp', 'SMTP_HOST'),
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
          from: env.EMAIL_FROM,
        })
      : env.EMAIL_PROVIDER === 'brevo'
        ? new BrevoEmailSender({
            apiKey: env.BREVO_API_KEY ?? missing('EMAIL_PROVIDER=brevo', 'BREVO_API_KEY'),
            from: env.EMAIL_FROM,
          })
        : new LogEmailSender(env.EMAIL_LOG_DIR);

  let billing: BillingProvider | null = null;
  if (env.BILLING_PROVIDER === 'stripe') {
    billing = new StripeBillingProvider({
      secretKey: env.STRIPE_SECRET_KEY ?? missing('BILLING_PROVIDER=stripe', 'STRIPE_SECRET_KEY'),
      webhookSecret:
        env.STRIPE_WEBHOOK_SECRET ?? missing('BILLING_PROVIDER=stripe', 'STRIPE_WEBHOOK_SECRET'),
    });
  }
  if (env.BILLING_PROVIDER === 'mock') billing = new MockBillingProvider();

  const summary = {
    ai: ai.name,
    messaging: messaging.name,
    storage: storage.name,
    speechToText: speechToText.name,
    email: email.name,
    billing: billing?.name ?? 'none',
  };
  const mocks = Object.entries(summary).filter(
    ([, name]) => name === 'mock' || name === 'local' || name === 'log',
  );
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
  return { ai, messaging, storage, speechToText, email, billing };
}
