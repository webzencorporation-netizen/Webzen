import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { MessageType } from '@botsaas/shared';
import { z } from 'zod';
import type {
  InboundMessage,
  NormalizedWebhookEvent,
  OutboundStatus,
  StatusUpdate,
  WhatsAppErrorDetail,
} from './types';

// ── Verificação (GET) ────────────────────────────────────────────────────────

export interface VerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

/** Retorna o challenge a ecoar quando a verificação é válida; `null` caso contrário. */
export function verifyWebhookSubscription(
  query: VerificationQuery,
  expectedToken: string,
): string | null {
  const token = query['hub.verify_token'];
  if (query['hub.mode'] !== 'subscribe' || !token || !query['hub.challenge']) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return query['hub.challenge'];
}

// ── Assinatura (POST) ────────────────────────────────────────────────────────

/**
 * Valida `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 do corpo BRUTO com o App Secret.
 * Deve ser calculado sobre os bytes recebidos, antes de qualquer parse de JSON.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const received = signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(received.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
}

export function signWebhookPayload(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

// ── Parse ────────────────────────────────────────────────────────────────────

const errorSchema = z.looseObject({
  code: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  error_data: z.looseObject({ details: z.string().optional() }).optional(),
});

const mediaSchema = z.looseObject({
  id: z.string(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  voice: z.boolean().optional(),
});

const messageSchema = z.looseObject({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.looseObject({ body: z.string() }).optional(),
  image: mediaSchema.optional(),
  audio: mediaSchema.optional(),
  video: mediaSchema.optional(),
  document: mediaSchema.optional(),
  sticker: mediaSchema.optional(),
  location: z
    .looseObject({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  contacts: z.array(z.unknown()).optional(),
  interactive: z
    .looseObject({
      type: z.string(),
      button_reply: z.looseObject({ id: z.string(), title: z.string() }).optional(),
      list_reply: z
        .looseObject({ id: z.string(), title: z.string(), description: z.string().optional() })
        .optional(),
    })
    .optional(),
  button: z.looseObject({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  reaction: z
    .looseObject({ message_id: z.string().optional(), emoji: z.string().optional() })
    .optional(),
  context: z.looseObject({ id: z.string().optional(), from: z.string().optional() }).optional(),
  errors: z.array(errorSchema).optional(),
});

const statusSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
  recipient_id: z.string().optional(),
  errors: z.array(errorSchema).optional(),
  pricing: z
    .looseObject({
      billable: z.boolean().optional(),
      category: z.string().optional(),
      pricing_model: z.string().optional(),
    })
    .optional(),
});

const valueSchema = z.looseObject({
  messaging_product: z.string().optional(),
  metadata: z
    .looseObject({ phone_number_id: z.string(), display_phone_number: z.string().optional() })
    .optional(),
  contacts: z
    .array(
      z.looseObject({
        wa_id: z.string(),
        profile: z.looseObject({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

export const webhookPayloadSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      id: z.string().optional(),
      changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

const TYPE_MAP: Record<string, MessageType> = {
  text: 'TEXT',
  image: 'IMAGE',
  audio: 'AUDIO',
  video: 'VIDEO',
  document: 'DOCUMENT',
  sticker: 'STICKER',
  location: 'LOCATION',
  contacts: 'CONTACTS',
  interactive: 'INTERACTIVE',
  button: 'BUTTON',
  reaction: 'REACTION',
};

const STATUS_VALUES = new Set<OutboundStatus>(['sent', 'delivered', 'read', 'failed']);

function toErrors(
  errors: z.infer<typeof errorSchema>[] | undefined,
): WhatsAppErrorDetail[] | undefined {
  if (!errors || errors.length === 0) return undefined;
  return errors.map((error) => ({
    code: error.code,
    title: error.title,
    message: error.message,
    details: error.error_data?.details,
  }));
}

function fromUnixSeconds(value: string): Date {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

export function normalizeInboundMessage(raw: z.infer<typeof messageSchema>): InboundMessage {
  const type = TYPE_MAP[raw.type] ?? 'UNSUPPORTED';
  const media = raw.image ?? raw.audio ?? raw.video ?? raw.document ?? raw.sticker;
  const message: InboundMessage = {
    externalId: raw.id,
    from: raw.from,
    timestamp: fromUnixSeconds(raw.timestamp),
    type,
    replyToExternalId: raw.context?.id,
    errors: toErrors(raw.errors),
  };
  if (raw.text) message.text = raw.text.body;
  if (media) {
    message.media = {
      id: media.id,
      mimeType: media.mime_type,
      sha256: media.sha256,
      caption: media.caption,
      filename: media.filename,
      voice: media.voice,
    };
    if (media.caption) message.text = media.caption;
  }
  if (raw.location) {
    message.location = raw.location;
    message.text =
      [raw.location.name, raw.location.address].filter(Boolean).join(' — ') || undefined;
  }
  if (raw.contacts) message.contacts = raw.contacts;
  if (raw.interactive) {
    const reply = raw.interactive.button_reply ?? raw.interactive.list_reply;
    message.interactive = {
      kind: raw.interactive.button_reply
        ? 'button_reply'
        : raw.interactive.list_reply
          ? 'list_reply'
          : 'other',
      id: reply?.id,
      title: reply?.title,
      description: raw.interactive.list_reply?.description,
    };
    if (reply?.title) message.text = reply.title;
  }
  if (raw.button) {
    message.button = { payload: raw.button.payload, text: raw.button.text };
    message.text = raw.button.text ?? raw.button.payload;
  }
  if (raw.reaction)
    message.reaction = { messageId: raw.reaction.message_id, emoji: raw.reaction.emoji };
  return message;
}

function normalizeStatus(raw: z.infer<typeof statusSchema>): StatusUpdate | null {
  if (!STATUS_VALUES.has(raw.status as OutboundStatus)) return null;
  return {
    externalId: raw.id,
    status: raw.status as OutboundStatus,
    recipientId: raw.recipient_id,
    timestamp: fromUnixSeconds(raw.timestamp),
    errors: toErrors(raw.errors),
    pricing: raw.pricing
      ? {
          billable: raw.pricing.billable,
          category: raw.pricing.category,
          pricingModel: raw.pricing.pricing_model,
        }
      : undefined,
  };
}

/**
 * Converte o payload da Meta em eventos normalizados, um por mensagem/status.
 * Cada evento tem uma `dedupeKey` estável usada para idempotência.
 */
export function parseWebhookPayload(payload: unknown): NormalizedWebhookEvent[] {
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') return [];

  const events: NormalizedWebhookEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const value = valueSchema.safeParse(change.value);
      if (change.field !== 'messages' || !value.success) {
        events.push({
          kind: 'unsupported',
          dedupeKey: `${change.field}:${createHash('sha256')
            .update(JSON.stringify(change.value ?? null))
            .digest('hex')}`,
          field: change.field,
          raw: change.value,
        });
        continue;
      }
      const phoneNumberId = value.data.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const contacts = value.data.contacts ?? [];

      for (const rawMessage of value.data.messages ?? []) {
        const message = messageSchema.safeParse(rawMessage);
        if (!message.success) continue;
        const contact = contacts.find((item) => item.wa_id === message.data.from) ?? contacts[0];
        events.push({
          kind: 'message',
          phoneNumberId,
          dedupeKey: message.data.id,
          contact: {
            waId: contact?.wa_id ?? message.data.from,
            profileName: contact?.profile?.name,
          },
          message: normalizeInboundMessage(message.data),
        });
      }

      for (const rawStatus of value.data.statuses ?? []) {
        const status = statusSchema.safeParse(rawStatus);
        if (!status.success) continue;
        const normalized = normalizeStatus(status.data);
        if (!normalized) continue;
        events.push({
          kind: 'status',
          phoneNumberId,
          dedupeKey: `${normalized.externalId}:${normalized.status}`,
          status: normalized,
        });
      }
    }
  }
  return events;
}
