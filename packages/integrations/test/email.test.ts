import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrevoEmailSender, parseMailbox } from '../src';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Rede real proibida neste teste');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const message = {
  to: 'cliente@exemplo.test',
  subject: 'Redefina sua senha',
  html: '<p>Olá</p>',
  text: 'Olá',
};

describe('e-mail pela API da Brevo', () => {
  it('separa nome e e-mail do remetente', () => {
    expect(parseMailbox('WebZen <contato@webzen.test>')).toEqual({
      name: 'WebZen',
      email: 'contato@webzen.test',
    });
    expect(parseMailbox('"Equipe WebZen" <contato@webzen.test>')).toEqual({
      name: 'Equipe WebZen',
      email: 'contato@webzen.test',
    });
    expect(parseMailbox(' contato@webzen.test ')).toEqual({ email: 'contato@webzen.test' });
  });

  it('envia pelo endpoint transacional com a chave no cabeçalho', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ messageId: '<abc@smtp-relay.mailin.fr>' }, { status: 201 }));
    const sender = new BrevoEmailSender({
      apiKey: 'xkeysib-fixture',
      from: 'WebZen <contato@webzen.test>',
      fetchImpl,
    });

    await expect(sender.send(message)).resolves.toEqual({
      messageId: '<abc@smtp-relay.mailin.fr>',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(new Headers(init?.headers).get('api-key')).toBe('xkeysib-fixture');
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: 'WebZen', email: 'contato@webzen.test' },
      to: [{ email: 'cliente@exemplo.test' }],
      subject: 'Redefina sua senha',
      htmlContent: '<p>Olá</p>',
      textContent: 'Olá',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falha com o código da Brevo sem expor a chave', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ code: 'unauthorized', message: 'Key not found' }, { status: 401 }),
      );
    const sender = new BrevoEmailSender({
      apiKey: 'xkeysib-segredo',
      from: 'contato@webzen.test',
      fetchImpl,
    });

    const failure = sender.send(message);
    await expect(failure).rejects.toThrow(
      'Brevo recusou o envio (HTTP 401): unauthorized — Key not found',
    );
    await expect(failure).rejects.not.toThrow(/xkeysib-segredo/);
  });
});
