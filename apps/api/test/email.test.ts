import { systemDb } from '@botsaas/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processEmail, queueEmail } from '../src/modules/email/service';
import { emailTemplates } from '../src/modules/email/templates';
import { createTestHarness, type TestHarness } from './helpers/harness';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});
afterAll(() => harness.close());
beforeEach(() => harness.reset());

describe('templates de e-mail', () => {
  it('escapa valores dinâmicos (nome de usuário não vira HTML)', () => {
    const email = emailTemplates.welcome({
      name: '<img src=x onerror=alert(1)>',
      companyName: 'A & B "Ltda"',
      url: 'http://localhost:3000/app/onboarding',
    });
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('A &amp; B &quot;Ltda&quot;');
    expect(email.text).toContain('A & B "Ltda"');
  });
});

describe('fila de e-mails', () => {
  const rendered = emailTemplates.passwordChanged({ name: 'Rita' });

  it('envia pelo job e apaga o corpo depois do envio', async () => {
    const id = await queueEmail(harness.container, {
      to: 'rita@x.test',
      template: 'passwordChanged',
      email: rendered,
    });
    expect(harness.queue.jobs.map((job) => job.name)).toContain('email.send');
    await processEmail(harness.container, id);
    expect(harness.email.sent).toHaveLength(1);
    const row = await systemDb.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'SENT', html: null, text: null, attempts: 1 });

    // Reprocessar (retry duplicado do job) não reenvia.
    await processEmail(harness.container, id);
    expect(harness.email.sent).toHaveLength(1);
  });

  it('falha temporária repete; na última tentativa marca FAILED e apaga o corpo', async () => {
    const id = await queueEmail(harness.container, {
      to: 'rita@x.test',
      template: 'passwordChanged',
      email: rendered,
    });
    harness.email.failNext(5);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(processEmail(harness.container, id)).rejects.toThrow();
    }
    const row = await systemDb.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5, html: null, text: null });
    expect(row.lastError).toContain('Falha simulada');
  });
});
