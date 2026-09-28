import { WhatsAppError } from '@botsaas/shared';
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

export interface CloudApiConfig {
  /** Ex.: https://graph.facebook.com */
  baseUrl: string;
  /** Ex.: v25.0 — configurável, nunca fixo no código. */
  apiVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Códigos da Graph/Cloud API em que repetir mais tarde é seguro, conforme a tabela oficial
 * (developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes,
 * conferida em 2026-09-27). 131049 (limite por usuário) pede espera de 24h: não é repetido
 * pelos retries curtos do worker.
 */
const RETRYABLE_ERROR_CODES = new Set([
  1, // API unknown
  2, // API service temporarily unavailable
  4, // Application request limit reached
  80007, // WABA rate limit
  130429, // Cloud API throughput reached
  131000, // Something went wrong
  131016, // Service unavailable
  131056, // Pair rate limit (mesmo destinatário)
  131057, // Conta em manutenção
  133004, // Servidor temporariamente indisponível
]);

/** Códigos com significado específico exibido ao atendente. */
export const WHATSAPP_ERROR_HINTS: Record<number, string> = {
  131047: 'Janela de 24h encerrada: envie um template aprovado.',
  131026: 'Mensagem não entregue (número sem WhatsApp ou bloqueio).',
  131051: 'Tipo de mensagem não suportado.',
  131053: 'Falha ao enviar mídia.',
  132000: 'Parâmetros do template não conferem.',
  132001: 'Template inexistente ou não aprovado.',
  0: 'Falha de autenticação na Meta: token expirado ou revogado — reconecte o WhatsApp.',
  190: 'Token de acesso expirado ou inválido — reconecte o WhatsApp.',
  368: 'Conta do WhatsApp Business restrita por violação de política — verifique o WhatsApp Manager.',
  130429: 'Limite de envio da API atingido — nova tentativa automática.',
  131031: 'Conta do WhatsApp Business bloqueada ou com verificação pendente.',
  131042: 'Problema na forma de pagamento da conta do WhatsApp Business.',
  131048: 'Envio bloqueado pela qualidade do número (spam) — verifique o WhatsApp Manager.',
  131049: 'A Meta limitou mensagens de marketing para este contato; tente após 24h.',
  131050: 'O contato parou de receber mensagens de marketing desta empresa.',
  131056: 'Muitas mensagens para o mesmo contato em pouco tempo.',
  131057: 'Conta do WhatsApp Business em manutenção — nova tentativa automática.',
  131062:
    'Este tipo de mensagem não pode ser enviado a contato identificado só por nome de usuário.',
  132015: 'Template pausado por baixa qualidade — edite e reenvie para aprovação.',
  132016: 'Template desativado permanentemente — crie um novo template.',
};

export class WhatsAppApiError extends WhatsAppError {
  constructor(
    message: string,
    readonly status: number,
    readonly graphCode: number | undefined,
    retryable: boolean,
    readonly fbtraceId?: string,
  ) {
    super(message, { retryable, details: { status, graphCode, fbtraceId } });
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_data?: { details?: string };
  };
}

export class CloudApiProvider implements MessagingProvider {
  readonly name = 'cloud' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CloudApiConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}/${this.config.apiVersion}/${path}`;
  }

  private async request<T>(
    credentials: WhatsAppCredentials,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        ...init,
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });
    } catch {
      throw new WhatsAppApiError('Falha de rede ao chamar a Cloud API.', 0, undefined, true);
    }
    const body = (await response.json().catch(() => ({}))) as T & GraphErrorBody;
    if (!response.ok || body.error) {
      throw toApiError(response.status, body);
    }
    return body;
  }

  private async postMessage(
    credentials: WhatsAppCredentials,
    payload: Record<string, unknown>,
  ): Promise<SendResult> {
    const body = await this.request<{ messages?: { id: string }[] }>(
      credentials,
      `${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...payload,
        }),
      },
    );
    const externalId = body.messages?.[0]?.id;
    if (!externalId)
      throw new WhatsAppApiError(
        'Resposta da Cloud API sem ID de mensagem.',
        200,
        undefined,
        false,
      );
    return { externalId };
  }

  sendText(credentials: WhatsAppCredentials, input: SendTextInput): Promise<SendResult> {
    return this.postMessage(credentials, {
      to: input.to,
      type: 'text',
      text: { body: input.text, preview_url: input.previewUrl ?? false },
      ...(input.replyToExternalId ? { context: { message_id: input.replyToExternalId } } : {}),
    });
  }

  sendTemplate(credentials: WhatsAppCredentials, input: SendTemplateInput): Promise<SendResult> {
    const components =
      input.components ??
      (input.bodyParameters && input.bodyParameters.length > 0
        ? [
            {
              type: 'body',
              parameters: input.bodyParameters.map((text) => ({ type: 'text', text })),
            },
          ]
        : undefined);
    return this.postMessage(credentials, {
      to: input.to,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        ...(components ? { components } : {}),
      },
    });
  }

  sendMedia(credentials: WhatsAppCredentials, input: SendMediaInput): Promise<SendResult> {
    if (!input.link && !input.mediaId)
      throw new WhatsAppApiError('Mídia sem link ou id.', 400, undefined, false);
    const media: Record<string, unknown> = input.mediaId
      ? { id: input.mediaId }
      : { link: input.link };
    if (input.caption && input.kind !== 'audio') media.caption = input.caption;
    if (input.filename && input.kind === 'document') media.filename = input.filename;
    return this.postMessage(credentials, { to: input.to, type: input.kind, [input.kind]: media });
  }

  async markAsRead(credentials: WhatsAppCredentials, externalMessageId: string): Promise<void> {
    await this.request(credentials, `${credentials.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: externalMessageId,
      }),
    });
  }

  async getMediaInfo(credentials: WhatsAppCredentials, mediaId: string): Promise<MediaInfo> {
    const body = await this.request<{
      url: string;
      mime_type: string;
      sha256?: string;
      file_size?: number;
    }>(credentials, encodeURIComponent(mediaId));
    return {
      url: body.url,
      mimeType: body.mime_type,
      sha256: body.sha256,
      fileSize: body.file_size,
    };
  }

  async downloadMedia(credentials: WhatsAppCredentials, url: string): Promise<Buffer> {
    const allowedHost = /(^|\.)(fbcdn\.net|facebook\.com|whatsapp\.net|fbsbx\.com)$/;
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !allowedHost.test(parsed.hostname)) {
      throw new WhatsAppApiError('URL de mídia fora dos domínios da Meta.', 400, undefined, false);
    }
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });
    if (!response.ok) {
      throw new WhatsAppApiError(
        `Falha ao baixar mídia (${response.status}).`,
        response.status,
        undefined,
        response.status >= 500 || response.status === 429,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async getPhoneNumberInfo(credentials: WhatsAppCredentials): Promise<PhoneNumberInfo> {
    const body = await this.request<{
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    }>(
      credentials,
      `${credentials.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    );
    return {
      displayPhoneNumber: body.display_phone_number,
      verifiedName: body.verified_name,
      qualityRating: body.quality_rating,
    };
  }

  async listTemplates(
    credentials: WhatsAppCredentials,
    wabaId: string,
  ): Promise<MessageTemplateInfo[]> {
    const body = await this.request<{
      data?: {
        id: string;
        name: string;
        language: string;
        category: string;
        status: string;
        components?: unknown[];
      }[];
    }>(
      credentials,
      `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,category,status,components&limit=200`,
    );
    return (body.data ?? []).map((template) => ({
      ...template,
      components: template.components ?? [],
    }));
  }

  /** Apps inscritos nos webhooks da WABA. Sem inscrição, a Meta não entrega mensagens. */
  async listSubscribedApps(
    credentials: WhatsAppCredentials,
    wabaId: string,
  ): Promise<SubscribedApp[]> {
    const body = await this.request<{
      data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[];
    }>(credentials, `${encodeURIComponent(wabaId)}/subscribed_apps`);
    return (body.data ?? []).map((entry) => ({
      id: entry.whatsapp_business_api_data?.id,
      name: entry.whatsapp_business_api_data?.name,
    }));
  }
}

export interface SubscribedApp {
  id?: string;
  name?: string;
}

export function toApiError(status: number, body: GraphErrorBody): WhatsAppApiError {
  const graph = body.error;
  const code = graph?.code;
  const hint = code !== undefined ? WHATSAPP_ERROR_HINTS[code] : undefined;
  const retryable =
    status === 429 || status >= 500 || (code !== undefined && RETRYABLE_ERROR_CODES.has(code));
  const message =
    hint ?? graph?.error_data?.details ?? graph?.message ?? `Erro da Cloud API (${status}).`;
  return new WhatsAppApiError(message, status, code, retryable, graph?.fbtrace_id);
}
