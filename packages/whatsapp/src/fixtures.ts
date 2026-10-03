/**
 * Construtores de payloads no formato da Meta — usados pelo simulador de WhatsApp do painel
 * (modo mock) e pelos testes. Mantidos aqui para que simulação e produção usem o MESMO parser.
 */
export function buildTextMessageWebhook(input: {
  phoneNumberId: string;
  from: string;
  text: string;
  messageId: string;
  profileName?: string;
  timestamp?: Date;
}) {
  const timestamp = Math.floor((input.timestamp ?? new Date()).getTime() / 1000).toString();
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550000000',
                phone_number_id: input.phoneNumberId,
              },
              contacts: [{ profile: { name: input.profileName ?? 'Cliente' }, wa_id: input.from }],
              messages: [
                {
                  from: input.from,
                  id: input.messageId,
                  timestamp,
                  type: 'text',
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildStatusWebhook(input: {
  phoneNumberId: string;
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string;
  errorCode?: number;
  errorTitle?: string;
  pricing?: { billable: boolean; category: string; pricing_model?: string; type?: string };
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550000000',
                phone_number_id: input.phoneNumberId,
              },
              statuses: [
                {
                  id: input.messageId,
                  status: input.status,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  recipient_id: input.recipientId,
                  ...(input.errorCode
                    ? { errors: [{ code: input.errorCode, title: input.errorTitle ?? 'Error' }] }
                    : {}),
                  ...(input.pricing ? { pricing: input.pricing } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
