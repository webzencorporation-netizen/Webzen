import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EmailMessage, EmailSender } from './types';

/**
 * Desenvolvimento: grava cada e-mail como .html (com destinatário e assunto no topo) no
 * diretório configurado, em vez de enviar. Abra o arquivo no navegador para seguir links.
 * Recusado em produção pela validação do ambiente.
 */
export class LogEmailSender implements EmailSender {
  readonly name = 'log' as const;

  constructor(private readonly directory: string) {}

  async send(message: EmailMessage) {
    const id = randomUUID();
    await mkdir(this.directory, { recursive: true });
    const header = `<!-- Para: ${message.to} | Assunto: ${message.subject} -->\n`;
    const file = path.join(
      this.directory,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.html`,
    );
    await writeFile(file, header + message.html, { mode: 0o600 });
    return { messageId: id };
  }
}
