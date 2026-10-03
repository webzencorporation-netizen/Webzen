import type { EmailMessage, EmailSender } from './types';

export interface BrevoConfig {
  apiKey: string;
  /** Remetente no formato `Nome <email>` ou só `email` (precisa estar verificado na Brevo). */
  from: string;
  /** Limite da requisição. Uma API lenta não pode travar o worker. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Separa `Nome <email@dominio>` em nome e e-mail. */
export function parseMailbox(value: string): { name?: string; email: string } {
  const match = value.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (match) {
    const name = match[1]?.replace(/^"|"$/g, '').trim();
    return name ? { name, email: match[2]! } : { email: match[2]! };
  }
  return { email: value.trim() };
}

/**
 * Brevo pela API HTTP (transacional). Alternativa ao SMTP para hospedagens que bloqueiam
 * as portas de e-mail (ex.: Railway fora do plano Pro). Mesma conta e cota do SMTP.
 */
export class BrevoEmailSender implements EmailSender {
  readonly name = 'brevo' as const;
  private readonly sender: { name?: string; email: string };

  constructor(private readonly config: BrevoConfig) {
    this.sender = parseMailbox(config.from);
  }

  async send(message: EmailMessage) {
    const response = await (this.config.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': this.config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      messageId?: unknown;
      code?: unknown;
      message?: unknown;
    } | null;
    if (!response.ok) {
      // Só código e mensagem da Brevo: nunca o corpo enviado nem a chave.
      const detail = [payload?.code, payload?.message].filter((part) => typeof part === 'string');
      throw new Error(`Brevo recusou o envio (HTTP ${response.status})${detail.length ? `: ${detail.join(' — ')}` : ''}`);
    }
    return { messageId: typeof payload?.messageId === 'string' ? payload.messageId : null };
  }
}
