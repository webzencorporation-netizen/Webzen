import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';

/** Busca global da empresa (contatos, conversas, leads, serviços) — sempre no escopo da empresa. */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preValidation: company('contacts:read'),
      schema: { querystring: z.object({ q: z.string().trim().min(2).max(100) }) },
    },
    async (request) => {
      const scope = scopeFromRequest(request);
      const q = request.query.q;
      const digits = q.replace(/\D/g, '');
      const contactFilter = {
        source: { not: 'test' },
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { email: { contains: q, mode: 'insensitive' as const } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      };
      const [contacts, conversations, leads, services] = await Promise.all([
        scope.db.contact.findMany({
          where: contactFilter,
          select: { id: true, name: true, phone: true },
          take: 8,
        }),
        scope.db.conversation.findMany({
          where: { channel: 'WHATSAPP', contact: contactFilter },
          select: {
            id: true,
            lastMessagePreview: true,
            contact: { select: { name: true, phone: true } },
          },
          take: 8,
          orderBy: { lastMessageAt: 'desc' },
        }),
        scope.db.lead.findMany({
          where: {
            OR: [{ title: { contains: q, mode: 'insensitive' } }, { contact: contactFilter }],
          },
          select: {
            id: true,
            title: true,
            contact: { select: { name: true } },
            stage: { select: { name: true } },
          },
          take: 8,
        }),
        scope.db.service.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          select: { id: true, name: true },
          take: 5,
        }),
      ]);
      return { contacts, conversations, leads, services };
    },
  );
};
