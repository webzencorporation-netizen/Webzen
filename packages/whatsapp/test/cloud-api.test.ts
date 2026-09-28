import { describe, expect, it } from 'vitest';
import { CloudApiProvider, toApiError, WhatsAppApiError } from '../src';

/**
 * Contrato do cliente da Cloud API com `fetch` simulado: URL versionada, cabeçalhos,
 * payloads documentados pela Meta e classificação de erros. Sem rede externa.
 */

const credentials = { phoneNumberId: 'PN1', accessToken: 'token-not-real' };

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('sem resposta simulada');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(impl: typeof fetch) {
  return new CloudApiProvider({
    baseUrl: 'https://graph.facebook.com/',
    apiVersion: 'v26.0',
    fetchImpl: impl,
  });
}

const accepted = () =>
  json(200, {
    messaging_product: 'whatsapp',
    contacts: [{ input: '5511999990000', wa_id: '5511999990000' }],
    messages: [{ id: 'wamid.OK' }],
  });

function body(call: Call | undefined) {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

describe('CloudApiProvider — envio', () => {
  it('texto: endpoint versionado do número, bearer token e payload documentado', async () => {
    const { impl, calls } = fakeFetch(accepted());
    const result = await provider(impl).sendText(credentials, {
      to: '5511999990000',
      text: 'Olá!',
      replyToExternalId: 'wamid.IN',
    });

    expect(result).toEqual({ externalId: 'wamid.OK' });
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v26.0/PN1/messages');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer token-not-real',
      'Content-Type': 'application/json',
    });
    expect(body(calls[0])).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999990000',
      type: 'text',
      text: { body: 'Olá!', preview_url: false },
      context: { message_id: 'wamid.IN' },
    });
  });

  it('template com parâmetros posicionais do corpo', async () => {
    const { impl, calls } = fakeFetch(accepted());
    await provider(impl).sendTemplate(credentials, {
      to: '5511999990000',
      templateName: 'lembrete_consulta',
      languageCode: 'pt_BR',
      bodyParameters: ['Ana', '10h'],
    });
    expect(body(calls[0])).toMatchObject({
      type: 'template',
      template: {
        name: 'lembrete_consulta',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ana' },
              { type: 'text', text: '10h' },
            ],
          },
        ],
      },
    });
  });

  it('mídia: legenda só onde a API aceita e nome de arquivo só em documento', async () => {
    const { impl, calls } = fakeFetch(accepted(), accepted());
    const whatsapp = provider(impl);
    await whatsapp.sendMedia(credentials, {
      to: '55',
      kind: 'audio',
      mediaId: 'MEDIA1',
      caption: 'ignorada',
    });
    await whatsapp.sendMedia(credentials, {
      to: '55',
      kind: 'document',
      link: 'https://cdn.example.com/a.pdf',
      caption: 'Orçamento',
      filename: 'orcamento.pdf',
    });
    expect(body(calls[0])).toMatchObject({ type: 'audio', audio: { id: 'MEDIA1' } });
    expect(body(calls[0]).audio).not.toHaveProperty('caption');
    expect(body(calls[1])).toMatchObject({
      type: 'document',
      document: {
        link: 'https://cdn.example.com/a.pdf',
        caption: 'Orçamento',
        filename: 'orcamento.pdf',
      },
    });
  });

  it('marca como lida pelo endpoint de mensagens', async () => {
    const { impl, calls } = fakeFetch(json(200, { success: true }));
    await provider(impl).markAsRead(credentials, 'wamid.IN');
    expect(body(calls[0])).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.IN',
    });
  });

  it('resposta 200 sem ID de mensagem não é tratada como aceite', async () => {
    const { impl } = fakeFetch(json(200, { messaging_product: 'whatsapp' }));
    const failure = await provider(impl)
      .sendText(credentials, { to: '55', text: 'x' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WhatsAppApiError);
    expect((failure as WhatsAppApiError).retryable).toBe(false);
  });
});

describe('CloudApiProvider — mídia recebida', () => {
  it('consulta metadados e baixa somente de domínios da Meta com o token', async () => {
    const { impl, calls } = fakeFetch(
      json(200, {
        url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        mime_type: 'image/jpeg',
        sha256: 'abc',
        file_size: 3,
      }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const whatsapp = provider(impl);
    const info = await whatsapp.getMediaInfo(credentials, 'MEDIA/1');
    const data = await whatsapp.downloadMedia(credentials, info.url);

    expect(calls[0]?.url).toBe('https://graph.facebook.com/v26.0/MEDIA%2F1');
    expect(info).toEqual({
      url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
      mimeType: 'image/jpeg',
      sha256: 'abc',
      fileSize: 3,
    });
    expect(calls[1]?.init.headers).toEqual({ Authorization: 'Bearer token-not-real' });
    expect([...data]).toEqual([1, 2, 3]);
  });

  it.each([
    'http://lookaside.fbsbx.com/a',
    'https://attacker.example.com/a',
    'https://fbsbx.com.attacker.example/a',
  ])('recusa URL de mídia fora da Meta sem enviar o token: %s', async (url) => {
    const { impl, calls } = fakeFetch();
    await expect(provider(impl).downloadMedia(credentials, url)).rejects.toBeInstanceOf(
      WhatsAppApiError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('CloudApiProvider — erros', () => {
  it('falha de rede é repetível e não expõe o token', async () => {
    const { impl } = fakeFetch(new TypeError('fetch failed'));
    const failure = (await provider(impl)
      .sendText(credentials, { to: '55', text: 'x' })
      .catch((error: unknown) => error)) as WhatsAppApiError;
    expect(failure.retryable).toBe(true);
    expect(JSON.stringify({ message: failure.message, details: failure.details })).not.toContain(
      'token-not-real',
    );
  });

  it('erro da Graph API preserva código e fbtrace_id', async () => {
    const { impl } = fakeFetch(
      json(400, {
        error: {
          message: '(#131047) Re-engagement message',
          type: 'OAuthException',
          code: 131047,
          error_data: { details: 'Message failed to send because more than 24 hours have passed' },
          fbtrace_id: 'TRACE1',
        },
      }),
    );
    const failure = (await provider(impl)
      .sendText(credentials, { to: '55', text: 'x' })
      .catch((error: unknown) => error)) as WhatsAppApiError;
    expect(failure).toMatchObject({ status: 400, graphCode: 131047, fbtraceId: 'TRACE1' });
    expect(failure.retryable).toBe(false);
    expect(failure.message).toMatch(/24h/);
  });

  it.each([
    [131057, true],
    [133004, true],
    [131056, true],
    [131048, false],
    [131049, false],
    [131050, false],
    [131062, false],
    [368, false],
  ])('código %i → repetível=%s conforme a tabela oficial', (code, retryable) => {
    expect(toApiError(400, { error: { code } }).retryable).toBe(retryable);
  });

  it.each([0, 131048, 131049, 131050, 131042, 131031, 368, 131062, 132015, 132016])(
    'código %i tem orientação para a equipe',
    (code) => {
      const error = toApiError(400, { error: { code, message: 'texto original da Meta' } });
      expect(error.message).not.toBe('texto original da Meta');
    },
  );
});
