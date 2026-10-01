import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from './types';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  /** Limite por etapa (conexão, saudação, resposta). Um SMTP lento não pode travar o worker. */
  timeoutMs?: number;
}

/** SMTP genérico (Resend, SES, Brevo, Google Workspace...). TLS exigido fora da porta 465. */
export class SmtpEmailSender implements EmailSender {
  readonly name = 'smtp' as const;
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    const timeout = config.timeoutMs ?? 15_000;
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: !config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      // O conteúdo é gerado pelo sistema; nunca deixar o transporte ler arquivos ou URLs.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { messageId: typeof info.messageId === 'string' ? info.messageId : null };
  }
}
