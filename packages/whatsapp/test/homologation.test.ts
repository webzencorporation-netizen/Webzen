import { describe, expect, it } from 'vitest';
import { runWhatsAppHomologation, type WhatsAppHomologationOptions } from '../src';

type Route = (url: URL, init: RequestInit) => Response | undefined;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function fakeGraph(route: Route) {
  const calls: { url: string; method: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.pathname + url.search, method: init?.method ?? 'GET' });
    return route(url, init ?? {}) ?? json(404, { error: { code: 100, message: 'rota' } });
  }) as typeof fetch;
  return { impl, calls };
}

const healthy: Route = (url, init) => {
  if (url.pathname === '/v26.0/PN1')
    return json(200, {
      display_phone_number: '+55 11 4000-0000',
      verified_name: 'Clínica Teste',
      quality_rating: 'GREEN',
    });
  if (url.pathname === '/v26.0/WABA1/subscribed_apps')
    return json(200, { data: [{ whatsapp_business_api_data: { id: 'APP1', name: 'BotsSaaS' } }] });
  if (url.pathname === '/v26.0/WABA1/message_templates')
    return json(200, {
      data: [
        {
          id: 'T1',
          name: 'hello_world',
          language: 'en_US',
          category: 'UTILITY',
          status: 'APPROVED',
        },
        { id: 'T2', name: 'promo', language: 'pt_BR', category: 'MARKETING', status: 'REJECTED' },
      ],
    });
  if (url.pathname === '/v26.0/PN1/messages' && init.method === 'POST')
    return json(200, { messages: [{ id: 'wamid.HML' }] });
  return undefined;
};

function options(
  impl: typeof fetch,
  overrides: Partial<WhatsAppHomologationOptions> = {},
): WhatsAppHomologationOptions {
  return {
    accessToken: 'token-not-real',
    phoneNumberId: 'PN1',
    wabaId: 'WABA1',
    baseUrl: 'https://graph.facebook.com',
    apiVersion: 'v26.0',
    webhook: { publicUrl: 'https://api.exemplo.com.br', appSecretSet: true, verifyTokenSet: true },
    fetchImpl: impl,
    ...overrides,
  };
}

describe('runWhatsAppHomologation', () => {
  it('aprova número, inscrição, templates e webhook sem enviar mensagem por padrão', async () => {
    const { impl, calls } = fakeGraph(healthy);
    const report = await runWhatsAppHomologation(options(impl));

    expect(report.passed).toBe(true);
    expect(report.checks.map(({ name, status }) => [name, status])).toEqual([
      ['URL do webhook', 'ok'],
      ['segredos do webhook', 'ok'],
      ['token e número', 'ok'],
      ['qualidade do número', 'ok'],
      ['inscrição do app na WABA', 'ok'],
      ['templates aprovados', 'ok'],
      ['envio de template', 'skipped'],
    ]);
    expect(report.checks[0]?.detail).toContain('https://api.exemplo.com.br/webhooks/whatsapp');
    expect(report.checks[5]?.detail).toBe('1 de 2: hello_world/en_US');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('envia o template somente para o número informado', async () => {
    const { impl, calls } = fakeGraph(healthy);
    const report = await runWhatsAppHomologation(options(impl, { sendTo: '5511999990000' }));
    expect(report.checks.at(-1)).toMatchObject({
      name: 'envio de template',
      status: 'ok',
      detail: expect.stringContaining('wamid.HML'),
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('token inválido reprova, não tenta demais chamadas e não expõe o token', async () => {
    const { impl, calls } = fakeGraph(() =>
      json(401, {
        error: { code: 190, message: 'Error validating access token', fbtrace_id: 'TR' },
      }),
    );
    const report = await runWhatsAppHomologation(options(impl, { sendTo: '5511999990000' }));

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'token e número')).toMatchObject({
      status: 'fail',
      detail: expect.stringMatching(/HTTP 401 código 190: Token .*fbtrace_id TR/),
    });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('token-not-real');
  });

  it('app não inscrito na WABA reprova; número sem qualidade GREEN gera aviso', async () => {
    const { impl } = fakeGraph((url, init) => {
      if (url.pathname === '/v26.0/PN1')
        return json(200, { display_phone_number: '+55', quality_rating: 'YELLOW' });
      if (url.pathname === '/v26.0/WABA1/subscribed_apps') return json(200, { data: [] });
      return healthy(url, init);
    });
    const report = await runWhatsAppHomologation(options(impl));
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'qualidade do número')?.status).toBe(
      'warn',
    );
    expect(report.checks.find((check) => check.name === 'inscrição do app na WABA')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('subscribed_apps'),
    });
  });

  it.each(['http://api.exemplo.com.br', 'https://localhost:4000', 'não é url'])(
    'URL pública inválida para webhook reprova: %s',
    async (publicUrl) => {
      const { impl } = fakeGraph(healthy);
      const report = await runWhatsAppHomologation(
        options(impl, { webhook: { publicUrl, appSecretSet: true, verifyTokenSet: true } }),
      );
      expect(report.passed).toBe(false);
      expect(report.checks[0]?.status).toBe('fail');
    },
  );

  it('sem WABA as verificações dependentes são puladas, sem reprovar', async () => {
    const { impl } = fakeGraph(healthy);
    const report = await runWhatsAppHomologation(options(impl, { wabaId: undefined }));
    expect(report.passed).toBe(true);
    expect(report.checks.filter((check) => check.status === 'skipped')).toHaveLength(3);
  });
});
