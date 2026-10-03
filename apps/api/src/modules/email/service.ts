import { systemDb } from '@botsaas/database';
import type { AppContainer } from '../../container';
import { JOB_RETRY_POLICY } from '../../queues/types';
import type { RenderedEmail } from './templates';

/**
 * E-mail transacional pela fila: o pedido HTTP só grava a mensagem e enfileira `email.send`
 * (sem SMTP no caminho da resposta). O job relê a linha, envia e apaga o corpo — links com
 * token não ficam guardados depois do envio.
 */
export async function queueEmail(
  container: AppContainer,
  input: { to: string; template: string; email: RenderedEmail },
): Promise<string> {
  const row = await systemDb.emailOutbox.create({
    data: {
      toEmail: input.to,
      template: input.template,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
    },
    select: { id: true },
  });
  await container.queue.enqueue('email.send', { emailId: row.id }, { jobId: `email-${row.id}` });
  return row.id;
}

export async function processEmail(container: AppContainer, emailId: string): Promise<void> {
  const email = await systemDb.emailOutbox.findUnique({ where: { id: emailId } });
  if (!email || email.status !== 'PENDING' || email.html === null || email.text === null) return;
  try {
    await container.providers.email.send({
      to: email.toEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (error) {
    const attempts = email.attempts + 1;
    const final = attempts >= JOB_RETRY_POLICY['email.send'].attempts;
    await systemDb.emailOutbox.update({
      where: { id: email.id },
      data: {
        attempts,
        lastError: (error instanceof Error ? error.message : 'Falha no envio').slice(0, 300),
        ...(final ? { status: 'FAILED', html: null, text: null } : {}),
      },
    });
    container.logger.warn(
      { emailId: email.id, template: email.template, attempts, final },
      'Falha ao enviar e-mail',
    );
    throw error;
  }
  await systemDb.emailOutbox.update({
    where: { id: email.id },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      attempts: email.attempts + 1,
      html: null,
      text: null,
    },
  });
}
