import { IntegrationError } from '@botsaas/shared';

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
  language?: string;
}

/**
 * Transcrição de áudio desacoplada. A API da Claude não transcreve áudio,
 * então usamos um serviço dedicado configurável (ou nenhum).
 */
export interface SpeechToTextProvider {
  readonly name: 'none' | 'mock' | 'openai-compatible';
  readonly enabled: boolean;
  transcribe(
    audio: Buffer,
    options: { mimeType: string; language?: string },
  ): Promise<TranscriptionResult>;
}

export class DisabledSpeechToText implements SpeechToTextProvider {
  readonly name = 'none' as const;
  readonly enabled = false;
  async transcribe(): Promise<TranscriptionResult> {
    throw new IntegrationError('Transcrição de áudio não configurada.');
  }
}

export class MockSpeechToText implements SpeechToTextProvider {
  readonly name = 'mock' as const;
  readonly enabled = true;
  constructor(private readonly fixedText = '[transcrição simulada do áudio]') {}
  async transcribe(): Promise<TranscriptionResult> {
    return { text: this.fixedText, language: 'pt' };
  }
}

export interface OpenAICompatibleSttConfig {
  /** Endpoint completo, ex.: https://api.openai.com/v1/audio/transcriptions */
  url: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

/** Qualquer serviço compatível com o endpoint multipart `/audio/transcriptions`. */
export class OpenAICompatibleSpeechToText implements SpeechToTextProvider {
  readonly name = 'openai-compatible' as const;
  readonly enabled = true;

  constructor(private readonly config: OpenAICompatibleSttConfig) {}

  async transcribe(
    audio: Buffer,
    options: { mimeType: string; language?: string },
  ): Promise<TranscriptionResult> {
    const baseMime = options.mimeType.split(';')[0]?.trim() ?? 'audio/ogg';
    const extension = EXTENSION_BY_MIME[baseMime] ?? 'ogg';
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: baseMime }),
      `audio.${extension}`,
    );
    form.append('model', this.config.model ?? 'whisper-1');
    if (options.language) form.append('language', options.language);
    form.append('response_format', 'json');

    const response = await (this.config.fetchImpl ?? fetch)(this.config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new IntegrationError(`Serviço de transcrição respondeu ${response.status}.`, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    const json = (await response.json()) as { text?: string; duration?: number; language?: string };
    return {
      text: (json.text ?? '').trim(),
      durationSeconds: json.duration,
      language: json.language,
    };
  }
}
