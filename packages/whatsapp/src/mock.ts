import { randomUUID } from 'node:crypto';
import type {
  MediaInfo,
  MessageTemplateInfo,
  MessagingProvider,
  PhoneNumberInfo,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppCredentials,
} from './types';

export interface MockSentMessage {
  phoneNumberId: string;
  kind: 'text' | 'template' | 'media';
  to: string;
  body: SendTextInput | SendTemplateInput | SendMediaInput;
  externalId: string;
  at: Date;
}

/**
 * Provider de desenvolvimento/testes: não envia nada para a Meta.
 * Mensagens "enviadas" ficam em memória e aparecem normalmente no painel.
 */
export class MockMessagingProvider implements MessagingProvider {
  readonly name = 'mock' as const;
  readonly sent: MockSentMessage[] = [];
  /** Permite simular falhas nos testes. */
  failNextWith: Error | null = null;

  private record(
    credentials: WhatsAppCredentials,
    kind: MockSentMessage['kind'],
    body: MockSentMessage['body'],
  ): SendResult {
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }
    const externalId = `wamid.mock.${randomUUID()}`;
    this.sent.push({
      phoneNumberId: credentials.phoneNumberId,
      kind,
      to: body.to,
      body,
      externalId,
      at: new Date(),
    });
    return { externalId };
  }

  async sendText(credentials: WhatsAppCredentials, input: SendTextInput): Promise<SendResult> {
    return this.record(credentials, 'text', input);
  }

  async sendTemplate(
    credentials: WhatsAppCredentials,
    input: SendTemplateInput,
  ): Promise<SendResult> {
    return this.record(credentials, 'template', input);
  }

  async sendMedia(credentials: WhatsAppCredentials, input: SendMediaInput): Promise<SendResult> {
    return this.record(credentials, 'media', input);
  }

  async markAsRead(): Promise<void> {}

  async getMediaInfo(_credentials: WhatsAppCredentials, mediaId: string): Promise<MediaInfo> {
    return {
      url: `https://lookaside.fbsbx.com/mock/${mediaId}`,
      mimeType: 'application/octet-stream',
    };
  }

  async downloadMedia(): Promise<Buffer> {
    return Buffer.from('mock-media');
  }

  async getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
    return {
      displayPhoneNumber: '+55 11 90000-0000',
      verifiedName: 'Número de teste',
      qualityRating: 'GREEN',
    };
  }

  async listTemplates(): Promise<MessageTemplateInfo[]> {
    return [
      {
        id: 'mock-template-1',
        name: 'retomar_atendimento',
        language: 'pt_BR',
        category: 'UTILITY',
        status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Olá {{1}}! Podemos continuar seu atendimento?' }],
      },
    ];
  }

  reset(): void {
    this.sent.length = 0;
    this.failNextWith = null;
  }
}
