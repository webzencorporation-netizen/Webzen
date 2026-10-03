import type { EmailMessage, EmailSender } from './types';

/** Testes: guarda os e-mails enviados; `failNext` simula falha do servidor. */
export class MemoryEmailSender implements EmailSender {
  readonly name = 'memory' as const;
  readonly sent: EmailMessage[] = [];
  private failures = 0;

  failNext(times = 1): void {
    this.failures = times;
  }

  async send(message: EmailMessage) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('Falha simulada no envio de e-mail');
    }
    this.sent.push(message);
    return { messageId: `mem-${this.sent.length}` };
  }

  reset(): void {
    this.sent.length = 0;
    this.failures = 0;
  }
}
