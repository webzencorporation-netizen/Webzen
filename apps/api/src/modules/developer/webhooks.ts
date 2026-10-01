import { randomBytes } from 'node:crypto';
import { systemDb, type Prisma } from '@botsaas/database';
import { NotFoundError, ValidationError, type WebhookEvent } from '@botsaas/shared';
import type { AppContainer } from '../../container';
import { requireSecrets } from '../../container';
import type { CompanyScope } from '../../context';
import { audit } from '../../lib/audit';
import { hmacSha256Hex } from '../../lib/crypto';
import { paginated, toSkipTake, type PaginationQuery } from '../../lib/http';
import { assertSafeUrl, safePost, UnsafeUrlError } from '../../lib/safe-http';
import { systemScope } from '../../lib/scope';
import { JOB_RETRY_POLICY } from '../../queues/types';
import { getEnabledFeatures } from '../features/service';

/** Eventos internos → nome público e estável do webhook. */
export const DOMAIN_TO_WEBHOOK_EVENT: Record<string, WebhookEvent> = {
  'contact.created': 'contact.created',
  'conversation.created': 'conversation.created',
  'conversation.closed': 'conversation.completed',
  'handoff.requested': 'conversation.handoff_requested',
  'message.received': 'message.received',
  'message.sent': 'message.sent',
  'lead.created': 'lead.created',
  'lead.stage_changed': 'lead.stage_changed',
  'appointment.created': 'appointment.created',
  'appointment.cancelled': 'appointment.cancelled',
  'agent.failed': 'bot.error',
  'subscription.updated': 'subscription.updated',
};

const MAX_ENDPOINTS = 10;
/** Falhas finais seguidas que desativam o endpoint (evita martelar um destino fora do ar). */
const DISABLE_AFTER_FAILURES = 15;

function urlOptions(container: AppContainer) {
  const production = container.env.NODE_ENV === 'production';
  return { allowPrivateNetworks: !production, requireHttps: production };
}

function validateUrl(container: AppContainer, url: string): string {
  try {
    return assertSafeUrl(url, urlOptions(container)).toString();
  } catch (error) {
    throw new ValidationError(error instanceof UnsafeUrlError ? error.message : 'URL inválida.');
  }
}

const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

const publicEndpoint = (endpoint: {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}) => ({
  id: endpoint.id,
  url: endpoint.url,
  description: endpoint.description,
  events: endpoint.events,
  isActive: endpoint.isActive,
  consecutiveFailures: endpoint.consecutiveFailures,
  disabledReason: endpoint.disabledReason,
  lastDeliveryAt: endpoint.lastDeliveryAt,
  createdAt: endpoint.createdAt,
});

export async function listEndpoints(scope: CompanyScope) {
  const endpoints = await scope.db.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' } });
  return endpoints.map(publicEndpoint);
}

/** Cria o endpoint e devolve o segredo de assinatura UMA vez (no banco, cifrado). */
export async function createEndpoint(
  scope: CompanyScope,
  input: { url: string; description?: string | null; events: WebhookEvent[] },
) {
  if ((await scope.db.webhookEndpoint.count()) >= MAX_ENDPOINTS) {
    throw new ValidationError(`Limite de ${MAX_ENDPOINTS} endpoints por empresa.`);
  }
  const url = validateUrl(scope.container, input.url);
  const secret = newSecret();
  const endpoint = await scope.db.webhookEndpoint.create({
    data: {
      companyId: scope.companyId,
      url,
      description: input.description?.trim() || null,
      events: [...new Set(input.events)],
      secretEncrypted: requireSecrets(scope.container).encrypt(secret),
    },
  });
  await audit(scope, {
    action: 'webhook_endpoint.created',
    resourceType: 'WebhookEndpoint',
    resourceId: endpoint.id,
    metadata: { host: new URL(url).host, events: endpoint.events },
  });
  return { ...publicEndpoint(endpoint), secret };
}

export async function updateEndpoint(
  scope: CompanyScope,
  id: string,
  input: { url?: string; description?: string | null; events?: WebhookEvent[]; isActive?: boolean },
) {
  const endpoint = await scope.db.webhookEndpoint.findUnique({ where: { id } });
  if (!endpoint) throw new NotFoundError('Endpoint não encontrado.');
  const updated = await scope.db.webhookEndpoint.update({
    where: { id },
    data: {
      ...(input.url !== undefined ? { url: validateUrl(scope.container, input.url) } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.events !== undefined ? { events: [...new Set(input.events)] } : {}),
      ...(input.isActive !== undefined
        ? {
            isActive: input.isActive,
            ...(input.isActive ? { consecutiveFailures: 0, disabledReason: null } : {}),
          }
        : {}),
    },
  });
  await audit(scope, {
    action: 'webhook_endpoint.updated',
    resourceType: 'WebhookEndpoint',
    resourceId: id,
    metadata: { fields: Object.keys(input) },
  });
  return publicEndpoint(updated);
}

export async function rotateEndpointSecret(scope: CompanyScope, id: string) {
  const endpoint = await scope.db.webhookEndpoint.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!endpoint) throw new NotFoundError('Endpoint não encontrado.');
  const secret = newSecret();
  await scope.db.webhookEndpoint.update({
    where: { id },
    data: { secretEncrypted: requireSecrets(scope.container).encrypt(secret) },
  });
  await audit(scope, {
    action: 'webhook_endpoint.secret_rotated',
    resourceType: 'WebhookEndpoint',
    resourceId: id,
  });
  return { secret };
}

export async function deleteEndpoint(scope: CompanyScope, id: string) {
  const removed = await scope.db.webhookEndpoint.deleteMany({ where: { id } });
  if (removed.count === 0) throw new NotFoundError('Endpoint não encontrado.');
  await audit(scope, {
    action: 'webhook_endpoint.deleted',
    resourceType: 'WebhookEndpoint',
    resourceId: id,
  });
}

export async function listDeliveries(
  scope: CompanyScope,
  endpointId: string,
  query: PaginationQuery,
) {
  const endpoint = await scope.db.webhookEndpoint.findUnique({
    where: { id: endpointId },
    select: { id: true },
  });
  if (!endpoint) throw new NotFoundError('Endpoint não encontrado.');
  const where = { endpointId };
  const [items, total] = await Promise.all([
    scope.db.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
      select: {
        id: true,
        event: true,
        eventId: true,
        status: true,
        attempts: true,
        responseStatus: true,
        lastError: true,
        deliveredAt: true,
        createdAt: true,
      },
    }),
    scope.db.webhookDelivery.count({ where }),
  ]);
  return paginated(items, total, query);
}

async function queueDelivery(
  container: AppContainer,
  companyId: string,
  deliveryId: string,
  suffix = '',
) {
  await container.queue.enqueue(
    'webhook.deliver',
    { companyId, deliveryId },
    { jobId: `webhook-${deliveryId}${suffix}` },
  );
}

/** Reenvia uma entrega (mesmo `eventId`: o receptor deduplica). */
export async function redeliver(scope: CompanyScope, deliveryId: string) {
  const delivery = await scope.db.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw new NotFoundError('Entrega não encontrada.');
  await scope.db.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'PENDING', attempts: 0, lastError: null },
  });
  await queueDelivery(scope.container, scope.companyId, deliveryId, `-replay-${Date.now()}`);
  await audit(scope, {
    action: 'webhook_delivery.replayed',
    resourceType: 'WebhookDelivery',
    resourceId: deliveryId,
  });
}

/** Evento de teste para conferir a integração do cliente. */
export async function sendTestEvent(scope: CompanyScope, endpointId: string) {
  const endpoint = await scope.db.webhookEndpoint.findUnique({
    where: { id: endpointId },
    select: { id: true },
  });
  if (!endpoint) throw new NotFoundError('Endpoint não encontrado.');
  const eventId = `evt_test_${randomBytes(8).toString('hex')}`;
  const delivery = await scope.db.webhookDelivery.create({
    data: {
      companyId: scope.companyId,
      endpointId,
      event: 'webhook.test',
      eventId,
      payload: { message: 'Evento de teste do WebZen.' },
    },
  });
  await queueDelivery(scope.container, scope.companyId, delivery.id);
  return { deliveryId: delivery.id };
}

/**
 * Chamado pelo despacho de eventos de domínio: cria uma entrega por endpoint inscrito.
 * Idempotente pela unicidade (endpoint, eventId) — reprocessar o evento não duplica.
 */
export async function fanOutWebhooks(
  scope: CompanyScope,
  event: { id: string; type: string; payload: Prisma.JsonValue; createdAt: Date },
): Promise<number> {
  const publicEvent = DOMAIN_TO_WEBHOOK_EVENT[event.type];
  if (!publicEvent) return 0;
  const endpoints = await scope.db.webhookEndpoint.findMany({
    where: { isActive: true, events: { has: publicEvent } },
    select: { id: true },
  });
  if (endpoints.length === 0) return 0;
  if (!(await getEnabledFeatures(scope)).has('WEBHOOKS')) return 0;
  let created = 0;
  for (const endpoint of endpoints) {
    try {
      const delivery = await scope.db.webhookDelivery.create({
        data: {
          companyId: scope.companyId,
          endpointId: endpoint.id,
          event: publicEvent,
          eventId: `evt_${event.id}`,
          payload: (event.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      await queueDelivery(scope.container, scope.companyId, delivery.id);
      created += 1;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') continue;
      throw error;
    }
  }
  return created;
}

/** Assinatura no estilo "t=<unix>,v1=<hmac>" sobre `${t}.${corpo}` (o receptor recusa replays antigos). */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** Job `webhook.deliver`. Lança em falha para o BullMQ repetir com backoff exponencial. */
export async function deliverWebhook(
  container: AppContainer,
  payload: { companyId: string; deliveryId: string },
  now: () => Date = () => new Date(),
): Promise<void> {
  const scope = systemScope(container, payload.companyId);
  const delivery = await scope.db.webhookDelivery.findUnique({
    where: { id: payload.deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status === 'SUCCEEDED') return;
  const { endpoint } = delivery;
  if (!endpoint.isActive) {
    await scope.db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'FAILED', lastError: 'Endpoint desativado.' },
    });
    return;
  }
  const body = JSON.stringify({
    id: delivery.eventId,
    type: delivery.event,
    createdAt: delivery.createdAt.toISOString(),
    data: delivery.payload,
  });
  const timestamp = Math.floor(now().getTime() / 1000);
  const secret = requireSecrets(container).decrypt(endpoint.secretEncrypted);
  const attempts = delivery.attempts + 1;
  let failure: string | null = null;
  let responseStatus: number | null = null;
  try {
    const response = await safePost(
      endpoint.url,
      body,
      {
        'user-agent': 'WebZen-Webhooks/1.0',
        'x-webzen-event': delivery.event,
        'x-webzen-delivery': delivery.id,
        'x-webzen-signature': signWebhook(secret, body, timestamp),
      },
      urlOptions(container),
    );
    responseStatus = response.status;
    if (response.status < 200 || response.status >= 300)
      failure = `Resposta HTTP ${response.status}`;
  } catch (error) {
    failure = (error instanceof Error ? error.message : 'Falha de rede').slice(0, 300);
  }

  if (!failure) {
    await systemDb.$transaction([
      systemDb.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUCCEEDED',
          attempts,
          responseStatus,
          lastError: null,
          deliveredAt: now(),
        },
      }),
      systemDb.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { consecutiveFailures: 0, lastDeliveryAt: now() },
      }),
    ]);
    return;
  }

  const final = attempts >= JOB_RETRY_POLICY['webhook.deliver'].attempts;
  await scope.db.webhookDelivery.update({
    where: { id: delivery.id },
    data: { attempts, responseStatus, lastError: failure, ...(final ? { status: 'FAILED' } : {}) },
  });
  if (final) {
    const updated = await scope.db.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (updated.consecutiveFailures >= DISABLE_AFTER_FAILURES && updated.isActive) {
      await scope.db.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          isActive: false,
          disabledReason: `Desativado após ${DISABLE_AFTER_FAILURES} entregas com falha seguidas.`,
        },
      });
      await scope.db.notification.create({
        data: {
          companyId: scope.companyId,
          type: 'INTEGRATION_DISCONNECTED',
          severity: 'WARNING',
          title: 'Webhook desativado',
          body: `O endpoint ${new URL(endpoint.url).host} falhou ${DISABLE_AFTER_FAILURES} vezes seguidas. Corrija e reative em Configurações → API e webhooks.`,
          link: '/app/settings/developer',
        },
      });
    }
  }
  throw new Error(`Entrega do webhook falhou: ${failure}`);
}
