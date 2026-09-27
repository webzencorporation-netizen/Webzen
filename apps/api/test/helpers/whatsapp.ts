import { systemDb } from '@botsaas/database';
import { buildStatusWebhook, buildTextMessageWebhook, signWebhookPayload } from '@botsaas/whatsapp';
import type { TestHarness } from './harness';

export const APP_SECRET = 'test-app-secret';

export async function createWhatsAppAccount(companyId: string, phoneNumberId: string) {
  return systemDb.whatsAppAccount.create({
    data: {
      companyId,
      phoneNumberId,
      displayPhoneNumber: '+55 11 4000-0000',
      status: 'CONNECTED',
      isDefault: true,
      connectedAt: new Date(),
    },
  });
}

export function postWebhook(harness: TestHarness, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return harness.app.inject({
    method: 'POST',
    url: '/webhooks/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature ?? signWebhookPayload(body, APP_SECRET),
    },
    payload: body,
  });
}

let counter = 0;
export function inboundText(phoneNumberId: string, from: string, text: string, messageId?: string) {
  counter += 1;
  return buildTextMessageWebhook({
    phoneNumberId,
    from,
    text,
    messageId: messageId ?? `wamid.test.${Date.now()}.${counter}`,
    profileName: 'João Cliente',
  });
}

export { buildStatusWebhook };
