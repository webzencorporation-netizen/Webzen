import { describe, expect, it } from 'vitest';
import {
  buildStatusWebhook,
  buildTextMessageWebhook,
  getMessagingWindow,
  normalizePhone,
  parseWebhookPayload,
  signWebhookPayload,
  toApiError,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from '../src';

const SECRET = 'app-secret';

describe('verificação do webhook', () => {
  it('ecoa o challenge somente com o token correto', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '123' };
    expect(verifyWebhookSubscription(query, 'tok')).toBe('123');
    expect(verifyWebhookSubscription({ ...query, 'hub.verify_token': 'x' }, 'tok')).toBeNull();
    expect(verifyWebhookSubscription({ ...query, 'hub.mode': 'other' }, 'tok')).toBeNull();
  });

  it('valida X-Hub-Signature-256 sobre o corpo bruto', () => {
    const body = JSON.stringify({ hello: 'world' });
    const signature = signWebhookPayload(body, SECRET);
    expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, signature, 'outro')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=zz', SECRET)).toBe(false);
  });
});

describe('parseWebhookPayload', () => {
  it('normaliza mensagem de texto', () => {
    const events = parseWebhookPayload(
      buildTextMessageWebhook({
        phoneNumberId: 'PN1',
        from: '5511999990000',
        text: 'oi',
        messageId: 'wamid.1',
        profileName: 'João',
      }),
    );
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      kind: 'message',
      phoneNumberId: 'PN1',
      dedupeKey: 'wamid.1',
      contact: { waId: '5511999990000', profileName: 'João' },
      message: { type: 'TEXT', text: 'oi', from: '5511999990000' },
    });
  });

  it('normaliza status com erro e gera chave de deduplicação por status', () => {
    const events = parseWebhookPayload(
      buildStatusWebhook({
        phoneNumberId: 'PN1',
        messageId: 'wamid.9',
        status: 'failed',
        recipientId: '55',
        errorCode: 131047,
      }),
    );
    expect(events[0]).toMatchObject({
      kind: 'status',
      dedupeKey: 'wamid.9:failed',
      status: { status: 'failed', errors: [{ code: 131047 }] },
    });
  });

  it('normaliza mídia, localização e respostas interativas', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PN1' },
                contacts: [{ wa_id: '55' }],
                messages: [
                  {
                    from: '55',
                    id: 'a',
                    timestamp: '1700000000',
                    type: 'audio',
                    audio: { id: 'm1', mime_type: 'audio/ogg', voice: true },
                  },
                  {
                    from: '55',
                    id: 'b',
                    timestamp: '1700000000',
                    type: 'location',
                    location: { latitude: -23.5, longitude: -46.6, name: 'Casa' },
                  },
                  {
                    from: '55',
                    id: 'c',
                    timestamp: '1700000000',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { id: 'yes', title: 'Sim' },
                    },
                  },
                  {
                    from: '55',
                    id: 'd',
                    timestamp: '1700000000',
                    type: 'image',
                    image: { id: 'm2', caption: 'olha', mime_type: 'image/jpeg' },
                    context: { id: 'wamid.prev' },
                  },
                  { from: '55', id: 'e', timestamp: '1700000000', type: 'weird_new_type' },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseWebhookPayload(payload);
    const messages = events.flatMap((event) => (event.kind === 'message' ? [event.message] : []));
    expect(messages.map((message) => message.type)).toEqual([
      'AUDIO',
      'LOCATION',
      'INTERACTIVE',
      'IMAGE',
      'UNSUPPORTED',
    ]);
    expect(messages[0]?.media).toMatchObject({ id: 'm1', voice: true });
    expect(messages[1]?.location).toMatchObject({ latitude: -23.5 });
    expect(messages[2]?.interactive).toMatchObject({
      kind: 'button_reply',
      id: 'yes',
      title: 'Sim',
    });
    expect(messages[2]?.text).toBe('Sim');
    expect(messages[3]).toMatchObject({ text: 'olha', replyToExternalId: 'wamid.prev' });
    expect(messages[0]?.timestamp.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('ignora payloads que não são do WhatsApp', () => {
    expect(parseWebhookPayload({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhookPayload('lixo')).toEqual([]);
  });
});

describe('janela de atendimento de 24h', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  it('aberta dentro de 24h da última mensagem do cliente', () => {
    const window = getMessagingWindow(new Date('2026-09-25T13:00:00Z'), now);
    expect(window.isOpen).toBe(true);
    expect(window.requiresTemplate).toBe(false);
    expect(window.remainingMs).toBe(60 * 60 * 1000);
  });
  it('fechada após 24h ou sem mensagem do cliente', () => {
    expect(getMessagingWindow(new Date('2026-09-25T11:59:59Z'), now).requiresTemplate).toBe(true);
    expect(getMessagingWindow(null, now)).toMatchObject({
      isOpen: false,
      requiresTemplate: true,
      expiresAt: null,
    });
  });
});

describe('utilitários', () => {
  it('normaliza telefones brasileiros', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('+1 555 000 1111')).toBe('15550001111');
    expect(normalizePhone('5511987654321')).toBe('5511987654321');
  });
  it('classifica erros da Cloud API como repetíveis ou não', () => {
    expect(toApiError(400, { error: { code: 131047, message: 'Re-engagement' } }).retryable).toBe(
      false,
    );
    expect(toApiError(400, { error: { code: 130429 } }).retryable).toBe(true);
    expect(toApiError(503, {}).retryable).toBe(true);
    expect(toApiError(401, { error: { code: 190 } }).message).toMatch(/Token/);
  });
});
