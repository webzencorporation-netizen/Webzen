import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, optionalText, patchSchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import { feature } from '../../features/service';
import * as crm from './service';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const crmRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = [company('crm:read'), feature('CRM')];
  const write = [company('crm:write'), feature('CRM')];
  const configure = [company('crm:configure'), feature('CRM')];

  app.get('/stages', { preValidation: read }, async (request) =>
    crm.listStages(scopeFromRequest(request)),
  );
  app.post(
    '/stages',
    {
      preValidation: configure,
      schema: {
        body: z.object({
          name: z.string().min(2).max(60),
          color: color.optional(),
          isWon: z.boolean().optional(),
          isLost: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) =>
      reply.status(201).send(await crm.createStage(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/stages/:id',
    {
      preValidation: configure,
      schema: {
        params: idParamSchema,
        body: z.object({
          name: z.string().min(2).max(60).optional(),
          color: color.optional(),
          isWon: z.boolean().optional(),
          isLost: z.boolean().optional(),
        }),
      },
    },
    async (request) => crm.updateStage(scopeFromRequest(request), request.params.id, request.body),
  );
  app.put(
    '/stages/order',
    { preValidation: configure, schema: { body: z.object({ ids: z.array(z.uuid()).max(50) }) } },
    async (request) => crm.reorderStages(scopeFromRequest(request), request.body.ids),
  );
  app.delete(
    '/stages/:id',
    { preValidation: configure, schema: { params: idParamSchema } },
    async (request) => {
      await crm.deleteStage(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get(
    '/leads',
    {
      preValidation: read,
      schema: {
        querystring: z.object({
          search: z.string().max(100).optional(),
          assigneeId: z.uuid().optional(),
          tagId: z.uuid().optional(),
          stageId: z.uuid().optional(),
          includeClosed: z.coerce.boolean().optional(),
        }),
      },
    },
    async (request) => crm.listLeads(scopeFromRequest(request), request.query),
  );
  app.post(
    '/leads',
    {
      preValidation: write,
      schema: {
        body: z.object({
          contactId: z.uuid(),
          stageId: z.uuid().optional(),
          title: optionalText(150),
          valueCents: z.number().int().min(0).nullish(),
          assigneeId: z.uuid().nullish(),
        }),
      },
    },
    async (request, reply) =>
      reply.status(201).send(await crm.createLead(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/leads/:id',
    {
      preValidation: write,
      schema: {
        params: idParamSchema,
        body: z.object({
          title: optionalText(150),
          valueCents: z.number().int().min(0).nullish(),
          assigneeId: z.uuid().nullish(),
          qualification: z
            .record(
              z.string().max(50),
              z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
            )
            .optional(),
        }),
      },
    },
    async (request) => crm.updateLead(scopeFromRequest(request), request.params.id, request.body),
  );
  app.post(
    '/leads/:id/move',
    {
      preValidation: write,
      schema: {
        params: idParamSchema,
        body: z.object({ stageId: z.uuid(), position: z.number().optional() }),
      },
    },
    async (request) => crm.moveLead(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/leads/:id',
    { preValidation: write, schema: { params: idParamSchema } },
    async (request) => {
      await crm.deleteLead(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get('/tags', { preValidation: company('contacts:read') }, async (request) =>
    crm.listTags(scopeFromRequest(request)),
  );
  app.post(
    '/tags',
    {
      preValidation: company('crm:configure'),
      schema: {
        body: z.object({ name: z.string().trim().min(1).max(40), color: color.optional() }),
      },
    },
    async (request, reply) =>
      reply.status(201).send(await crm.createTag(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/tags/:id',
    {
      preValidation: company('crm:configure'),
      schema: {
        params: idParamSchema,
        body: z.object({
          name: z.string().trim().min(1).max(40).optional(),
          color: color.optional(),
        }),
      },
    },
    async (request) => crm.updateTag(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/tags/:id',
    { preValidation: company('crm:configure'), schema: { params: idParamSchema } },
    async (request) => {
      await crm.deleteTag(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  const fieldBody = z.object({
    target: z.enum(['CONTACT', 'LEAD']),
    key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Use letras minúsculas, números e _'),
    label: z.string().min(2).max(80),
    type: z.enum(['TEXT', 'NUMBER', 'SELECT', 'BOOLEAN', 'DATE']),
    options: z.array(z.string().min(1).max(60)).max(30).optional(),
    collectByAgent: z.boolean().optional(),
    agentHint: optionalText(200),
  });
  app.get('/fields', { preValidation: company('contacts:read') }, async (request) =>
    crm.listCustomFields(scopeFromRequest(request)),
  );
  app.post(
    '/fields',
    { preValidation: company('crm:configure'), schema: { body: fieldBody } },
    async (request, reply) =>
      reply.status(201).send(await crm.createCustomField(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/fields/:id',
    {
      preValidation: company('crm:configure'),
      schema: {
        params: idParamSchema,
        body: patchSchema(fieldBody.omit({ key: true, target: true })),
      },
    },
    async (request) =>
      crm.updateCustomField(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/fields/:id',
    { preValidation: company('crm:configure'), schema: { params: idParamSchema } },
    async (request) => {
      await crm.deleteCustomField(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
};
