import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, optionalText, paginationQuerySchema, patchSchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as contacts from './service';

const customFieldsSchema = z.record(
  z.string().max(50),
  z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
);

const contactBody = z.object({
  name: optionalText(120),
  phone: z.string().min(8).max(30),
  email: z.email().max(200).nullish(),
  source: optionalText(50),
  status: optionalText(50),
  assigneeId: z.uuid().nullish(),
  customFields: customFieldsSchema.optional(),
  nextActionAt: z.coerce.date().nullish(),
  nextActionNote: optionalText(300),
  optedOut: z.boolean().optional(),
});

export const contactRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preValidation: company('contacts:read'),
      schema: {
        querystring: paginationQuerySchema.extend({
          search: z.string().max(100).optional(),
          tagId: z.uuid().optional(),
          assigneeId: z.uuid().optional(),
          status: z.string().max(50).optional(),
          sort: z.enum(['recent', 'name', 'created']).optional(),
        }),
      },
    },
    async (request) => contacts.listContacts(scopeFromRequest(request), request.query),
  );

  app.post(
    '/',
    { preValidation: company('contacts:write'), schema: { body: contactBody } },
    async (request, reply) =>
      reply.status(201).send(await contacts.createContact(scopeFromRequest(request), request.body)),
  );

  app.get(
    '/:id',
    { preValidation: company('contacts:read'), schema: { params: idParamSchema } },
    async (request) => contacts.getContact(scopeFromRequest(request), request.params.id),
  );

  app.patch(
    '/:id',
    {
      preValidation: company('contacts:write'),
      schema: { params: idParamSchema, body: patchSchema(contactBody) },
    },
    async (request) =>
      contacts.updateContact(scopeFromRequest(request), request.params.id, request.body),
  );

  app.delete(
    '/:id',
    { preValidation: company('contacts:delete'), schema: { params: idParamSchema } },
    async (request) => {
      await contacts.deleteContact(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get(
    '/:id/export',
    { preValidation: company('contacts:export'), schema: { params: idParamSchema } },
    async (request) => contacts.exportContactData(scopeFromRequest(request), request.params.id),
  );

  app.put(
    '/:id/tags',
    {
      preValidation: company('contacts:write'),
      schema: { params: idParamSchema, body: z.object({ tagIds: z.array(z.uuid()).max(50) }) },
    },
    async (request) =>
      contacts.setContactTags(scopeFromRequest(request), request.params.id, request.body.tagIds),
  );

  app.get(
    '/:id/notes',
    { preValidation: company('contacts:read'), schema: { params: idParamSchema } },
    async (request) => contacts.listNotes(scopeFromRequest(request), request.params.id),
  );

  app.post(
    '/:id/notes',
    {
      preValidation: company('contacts:write'),
      schema: { params: idParamSchema, body: z.object({ body: z.string().min(1).max(2000) }) },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await contacts.createNote(
            scopeFromRequest(request),
            request.params.id,
            request.body.body,
          ),
        ),
  );

  app.delete(
    '/:id/notes/:noteId',
    {
      preValidation: company('contacts:write'),
      schema: { params: idParamSchema.extend({ noteId: z.uuid() }) },
    },
    async (request) => {
      await contacts.deleteNote(scopeFromRequest(request), request.params.noteId);
      return { ok: true };
    },
  );

  app.get(
    '/:id/memories',
    { preValidation: company('contacts:read'), schema: { params: idParamSchema } },
    async (request) => contacts.listMemories(scopeFromRequest(request), request.params.id),
  );

  app.put(
    '/:id/memories',
    {
      preValidation: company('contacts:write'),
      schema: {
        params: idParamSchema,
        body: z.object({ key: z.string().min(1).max(50), value: z.string().min(1).max(300) }),
      },
    },
    async (request) =>
      contacts.upsertMemory(
        scopeFromRequest(request),
        request.params.id,
        request.body.key,
        request.body.value,
      ),
  );

  app.delete(
    '/:id/memories/:memoryId',
    {
      preValidation: company('contacts:write'),
      schema: { params: idParamSchema.extend({ memoryId: z.uuid() }) },
    },
    async (request) => {
      await contacts.deleteMemory(scopeFromRequest(request), request.params.memoryId);
      return { ok: true };
    },
  );
};
