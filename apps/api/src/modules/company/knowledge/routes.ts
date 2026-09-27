import { KNOWLEDGE_ENTRY_TYPES, ValidationError } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, paginationQuerySchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import { feature } from '../../features/service';
import { assertWithinLimit } from '../../usage/limits';
import { deleteKnowledgeDocument, uploadKnowledgeDocument } from './documents';
import * as knowledge from './service';

const entryBody = z.object({
  type: z.enum(KNOWLEDGE_ENTRY_TYPES).default('TEXT'),
  title: z.string().min(2).max(200),
  content: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  isActive: z.boolean().optional(),
});

export const knowledgeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/entries',
    {
      preValidation: company('knowledge:read'),
      schema: {
        querystring: paginationQuerySchema.extend({
          search: z.string().max(200).optional(),
          type: z.enum(KNOWLEDGE_ENTRY_TYPES).optional(),
          includeDocuments: z.coerce.boolean().optional(),
        }),
      },
    },
    async (request) => knowledge.listEntries(scopeFromRequest(request), request.query),
  );

  app.post(
    '/entries',
    { preValidation: company('knowledge:write'), schema: { body: entryBody } },
    async (request, reply) =>
      reply.status(201).send(await knowledge.createEntry(scopeFromRequest(request), request.body)),
  );

  app.patch(
    '/entries/:id',
    {
      preValidation: company('knowledge:write'),
      schema: { params: idParamSchema, body: entryBody.partial() },
    },
    async (request) =>
      knowledge.updateEntry(scopeFromRequest(request), request.params.id, request.body),
  );

  app.delete(
    '/entries/:id',
    { preValidation: company('knowledge:write'), schema: { params: idParamSchema } },
    async (request) => {
      await knowledge.deleteEntry(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get(
    '/search',
    {
      preValidation: company('knowledge:read'),
      schema: { querystring: z.object({ q: z.string().min(2).max(300) }) },
    },
    async (request) => knowledge.searchLikeAgent(scopeFromRequest(request), request.query.q),
  );

  app.get('/documents', { preValidation: company('knowledge:read') }, async (request) =>
    knowledge.listDocuments(scopeFromRequest(request)),
  );

  app.post(
    '/documents',
    { preValidation: [company('knowledge:write'), feature('KNOWLEDGE_UPLOADS')] },
    async (request, reply) => {
      const scope = scopeFromRequest(request);
      const file = await request.file();
      if (!file) throw new ValidationError('Envie um arquivo.');
      const data = await file.toBuffer();
      if (file.file.truncated) throw new ValidationError('Arquivo excede o tamanho máximo.');
      await assertWithinLimit(scope, 'STORAGE_MB', data.length / (1024 * 1024));
      const titleField = file.fields.title;
      const title =
        titleField &&
        'value' in titleField &&
        typeof titleField.value === 'string' &&
        titleField.value.trim()
          ? titleField.value.trim().slice(0, 200)
          : file.filename;
      return reply
        .status(201)
        .send(await uploadKnowledgeDocument(scope, { title, fileName: file.filename, data }));
    },
  );

  app.delete(
    '/documents/:id',
    { preValidation: company('knowledge:write'), schema: { params: idParamSchema } },
    async (request) => {
      await deleteKnowledgeDocument(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
};
