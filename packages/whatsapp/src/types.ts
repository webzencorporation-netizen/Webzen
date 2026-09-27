import type { MessageType } from '@botsaas/shared';

/** Credenciais de UM número (resolvidas pelo backend; nunca expostas ao navegador). */
export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface SendTextInput {
  to: string;
  text: string;
  replyToExternalId?: string;
  previewUrl?: boolean;
}

export interface TemplateParameter {
  type: 'text';
  text: string;
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  languageCode: string;
  /** Parâmetros do corpo ({{1}}, {{2}}...). Estruturas avançadas via `components`. */
  bodyParameters?: string[];
  components?: unknown[];
}

export interface SendMediaInput {
  to: string;
  kind: 'image' | 'document' | 'audio' | 'video';
  /** URL pública OU id de mídia já enviada à Meta. */
  link?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

export interface SendResult {
  externalId: string;
}

export interface MediaInfo {
  url: string;
  mimeType: string;
  sha256?: string;
  fileSize?: number;
}

export interface PhoneNumberInfo {
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
}

export interface MessageTemplateInfo {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
}

/** Abstração do canal de mensagens. O domínio não conhece a Graph API. */
export interface MessagingProvider {
  readonly name: 'cloud' | 'mock';
  sendText(credentials: WhatsAppCredentials, input: SendTextInput): Promise<SendResult>;
  sendTemplate(credentials: WhatsAppCredentials, input: SendTemplateInput): Promise<SendResult>;
  sendMedia(credentials: WhatsAppCredentials, input: SendMediaInput): Promise<SendResult>;
  markAsRead(credentials: WhatsAppCredentials, externalMessageId: string): Promise<void>;
  getMediaInfo(credentials: WhatsAppCredentials, mediaId: string): Promise<MediaInfo>;
  downloadMedia(credentials: WhatsAppCredentials, url: string): Promise<Buffer>;
  getPhoneNumberInfo(credentials: WhatsAppCredentials): Promise<PhoneNumberInfo>;
  listTemplates(credentials: WhatsAppCredentials, wabaId: string): Promise<MessageTemplateInfo[]>;
}

// ── Eventos de webhook normalizados ──────────────────────────────────────────

export interface InboundMedia {
  id: string;
  mimeType?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

export interface InboundMessage {
  externalId: string;
  from: string;
  timestamp: Date;
  type: MessageType;
  text?: string;
  media?: InboundMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  interactive?: {
    kind: 'button_reply' | 'list_reply' | 'other';
    id?: string;
    title?: string;
    description?: string;
  };
  button?: { payload?: string; text?: string };
  reaction?: { messageId?: string; emoji?: string };
  replyToExternalId?: string;
  errors?: WhatsAppErrorDetail[];
}

export interface WhatsAppErrorDetail {
  code?: number;
  title?: string;
  message?: string;
  details?: string;
}

export type OutboundStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface StatusUpdate {
  externalId: string;
  status: OutboundStatus;
  recipientId?: string;
  timestamp: Date;
  errors?: WhatsAppErrorDetail[];
  pricing?: { billable?: boolean; category?: string; pricingModel?: string };
}

export type NormalizedWebhookEvent =
  | {
      kind: 'message';
      phoneNumberId: string;
      dedupeKey: string;
      contact: { waId: string; profileName?: string };
      message: InboundMessage;
    }
  | { kind: 'status'; phoneNumberId: string; dedupeKey: string; status: StatusUpdate }
  | { kind: 'unsupported'; phoneNumberId?: string; dedupeKey: string; field: string; raw: unknown };
