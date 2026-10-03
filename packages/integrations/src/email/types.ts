/** E-mail já renderizado (assunto, HTML e texto puro). */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  readonly name: 'smtp' | 'log' | 'memory';
  /** Envia o e-mail; lança erro em falha (o job decide se repete). */
  send(message: EmailMessage): Promise<{ messageId: string | null }>;
}
