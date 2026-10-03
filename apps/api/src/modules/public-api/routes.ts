import { ConflictError, ValidationError, type ApiScope } from '@botsaas/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CompanyScope } from '../../context';
import { sha256 } from '../../lib/crypto';
import { idParamSchema, optionalText, paginationQuerySchema } from '../../lib/http';
import { apiKey } from '../../plugins/guards';
import * as contacts from '../company/contacts/service';
import * as conversations from '../company/conversations/service';
import { apiKeyScope } from '../developer/api-keys';
import { queueOutboundText } from '../messaging/outbound';

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;
const memoryIdempotency = new Map<string, { expiresAt: number; status: number; body: unknown }>();

function scopeOf(request: FastifyRequest): CompanyScope {
  const context = request.apiKeyContext;
  if (!context) throw new ValidationError('Chave de API ausente.');
  return apiKeyScope(request.server.container, context, request.id, request.ip);
}

/**
 * `Idempotency-Key`: o mesmo POST repetido (retry do cliente) devolve a resposta original
 * em vez de criar de novo. Guardado no Redis por 24 h (memória local sem Redis).
 */
async function idempotent(
  request: FastifyRequest,
  reply: FastifyReply,
  run: () => Promise<{ status: number; body: unknown }>,
) {
  const header = request.headers['idempotency-key'];
  if (typeof header !== 'string') {
    const result = await run();
    return reply.status(result.status).send(result.body);
  }
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(header)) {
    throw new ValidationError(
      'Idempotency-Key inválida (8 a 100 caracteres: letras, números, _ ou -).',
    );
  }
  const key = `idem:${request.apiKeyContext?.keyId}:${request.routeOptions.url}:${header}`;
  const { redis } = request.server.container;
  let parsed: { status: number; body: unknown } | null;
  if (redis) {
    const cached = await redis.get(key);
    parsed = cached ? (JSON.parse(cached) as { status: number; body: unknown }) : null;
  } else {
    const entry = memoryIdempotency.get(key);
    parsed = entry && entry.expiresAt > Date.now() ? entry : null;
  }
  if (parsed)
    return reply.status(parsed.status).header('idempotent-replayed', 'true').send(parsed.body);
  const result = await run();
  const value = { status: result.status, body: result.body };
  if (redis) await redis.set(key, JSON.stringify(value), 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  else
    memoryIdempotency.set(key, {
      ...value,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_SECONDS * 1000,
    });
  return reply.status(result.status).send(result.body);
}

const contactCreate = z.object({
  phone: z.string().min(8).max(30),
  name: optionalText(120),
  email: z.email().max(200).nullish(),
  source: optionalText(50),
});

/** Contato no formato público: sem campos internos (memórias, responsável interno etc.). */
function publicContact(contact: Awaited<ReturnType<typeof contacts.getContact>>) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    source: contact.source,
    status: contact.status,
    tags: contact.tags,
    optedOut: contact.optedOut,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

/**
 * API pública v1 (plano com "API e chaves de acesso"). Autenticação só por
 * `Authorization: Bearer wz_...`; cada rota exige um escopo da chave. Versionada no prefixo:
 * mudanças incompatíveis entram em /api/v2 sem quebrar integrações existentes.
 */
export const publicApiRoutes: FastifyPluginAsyncZod = async (app) => {
  const guard = (scope: ApiScope) => ({
    preValidation: apiKey(scope),
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute',
        // Limite por chave (não só por IP): uma integração não derruba a API das outras.
        keyGenerator: (request: FastifyRequest) =>
          `apikey:${sha256(request.headers.authorization ?? request.ip)}`,
      },
    },
  });

  app.get(
    '/contacts',
    {
      ...guard('contacts:read'),
      schema: {
        querystring: paginationQuerySchema.extend({ search: z.string().max(100).optional() }),
      },
    },
    async (request) => {
      const result = await contacts.listContacts(scopeOf(request), {
        ...request.query,
        sort: 'created',
      });
      return { ...result, items: result.items.map(publicContact) };
    },
  );

  app.get(
    '/contacts/:id',
    { ...guard('contacts:read'), schema: { params: idParamSchema } },
    async (request) =>
      publicContact(await contacts.getContact(scopeOf(request), request.params.id)),
  );

  app.post(
    '/contacts',
    { ...guard('contacts:write'), schema: { body: contactCreate } },
    async (request, reply) =>
      idempotent(request, reply, async () => {
        const scope = scopeOf(request);
        try {
          const created = await contacts.createContact(scope, {
            ...request.body,
            source: request.body.source ?? 'api',
          });
          return { status: 201, body: publicContact(created) };
        } catch (error) {
          if (error instanceof ConflictError)
            throw new ConflictError('Já existe um contato com este telefone.');
          throw error;
        }
      }),
  );

  app.get(
    '/conversations',
    {
      ...guard('conversations:read'),
      schema: {
        querystring: paginationQuerySchema.extend({ search: z.string().max(100).optional() }),
      },
    },
    async (request) => {
      const result = await conversations.listConversations(scopeOf(request), {
        ...request.query,
        filter: 'all',
      });
      return {
        items: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      };
    },
  );

  app.get(
    '/conversations/:id/messages',
    {
      ...guard('conversations:read'),
      schema: {
        params: idParamSchema,
        querystring: z.object({
          before: z.coerce.date().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) => {
      const result = await conversations.listMessages(
        scopeOf(request),
        request.params.id,
        request.query,
      );
      return {
        items: result.items.map((message) => ({
          id: message.id,
          direction: message.direction,
          sender: message.sender,
          type: message.type,
          text: message.text,
          status: message.status,
          createdAt: message.createdAt,
          sentAt: message.sentAt,
          deliveredAt: message.deliveredAt,
          readAt: message.readAt,
        })),
        hasMore: result.hasMore,
      };
    },
  );

  app.post(
    '/messages',
    {
      ...guard('messages:send'),
      schema: {
        body: z.object({ conversationId: z.uuid(), text: z.string().trim().min(1).max(4096) }),
      },
    },
    async (request, reply) =>
      idempotent(request, reply, async () => {
        const message = await queueOutboundText(scopeOf(request), {
          conversationId: request.body.conversationId,
          text: request.body.text,
          sender: 'AGENT',
        });
        return {
          status: 202,
          body: { id: message.id, status: message.status, createdAt: message.createdAt },
        };
      }),
  );
};
