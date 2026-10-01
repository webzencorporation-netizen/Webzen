import { ServiceUnavailableError } from './errors';
import { AuthenticationError } from '@botsaas/shared';
import {
  parseWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSubscription,
  type VerificationQuery,
} from '@botsaas/whatsapp';
import type { FastifyPluginAsync } from 'fastify';
import { BillingSignatureError } from '../billing/provider';
import { recordBillingEvent } from '../billing/service';
import { recordWebhookEvent } from './service';

/**
 * Webhook da WhatsApp Cloud API.
 * GET  → verificação da assinatura do webhook (hub.challenge)
 * POST → eventos; valida X-Hub-Signature-256, deduplica, persiste, enfileira e responde rápido.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const { env, logger } = app.container;

  app.get('/whatsapp', async (request, reply) => {
    if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) throw new ServiceUnavailableError();
    const challenge = verifyWebhookSubscription(
      request.query as VerificationQuery,
      env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    );
    if (!challenge) return reply.status(403).send('Forbidden');
    return reply.type('text/plain').send(challenge);
  });

  app.post(
    '/whatsapp',
    { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!env.WHATSAPP_APP_SECRET) throw new ServiceUnavailableError();
      const signature = request.headers['x-hub-signature-256'];
      const valid =
        request.rawBody !== undefined &&
        verifyWebhookSignature(
          request.rawBody,
          typeof signature === 'string' ? signature : undefined,
          env.WHATSAPP_APP_SECRET,
        );
      if (!valid) {
        logger.warn({ requestId: request.id }, 'Webhook com assinatura inválida rejeitado');
        throw new AuthenticationError('Assinatura inválida.');
      }

      const events = parseWebhookPayload(request.body);
      const outcomes: Record<string, number> = {};
      for (const event of events) {
        const outcome = await recordWebhookEvent(app.container, event);
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      return reply.status(200).send({ received: events.length, outcomes });
    },
  );

  /**
   * Webhook da cobrança (Stripe). Assinatura sobre o corpo bruto; o evento é gravado
   * (idempotente) e processado pela fila, que relê o objeto na Stripe.
   */
  app.post(
    '/stripe',
    { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const provider = app.container.providers.billing;
      if (!provider) throw new ServiceUnavailableError();
      const signature =
        request.headers[provider.name === 'stripe' ? 'stripe-signature' : 'x-mock-signature'];
      let event;
      try {
        event = provider.parseWebhook(
          request.rawBody ?? Buffer.alloc(0),
          typeof signature === 'string' ? signature : undefined,
        );
      } catch (error) {
        if (error instanceof BillingSignatureError) {
          logger.warn({ requestId: request.id }, 'Webhook de cobrança com assinatura inválida');
          throw new AuthenticationError('Assinatura inválida.');
        }
        throw error;
      }
      const outcome = await recordBillingEvent(app.container, provider, event);
      return reply.status(200).send({ received: true, outcome });
    },
  );
};
