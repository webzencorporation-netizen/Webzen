import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, optionalText, paginationQuerySchema, patchSchema } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as catalog from './service';

const baseItem = {
  name: z.string().trim().min(2).max(150),
  description: optionalText(2000),
  category: optionalText(80),
  priceCents: z.number().int().min(0).max(1_000_000_000).nullish(),
  priceNote: optionalText(120),
  priceVisibleToAi: z.boolean().optional(),
  isActive: z.boolean().optional(),
};
const serviceBody = z.object({
  ...baseItem,
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .nullish(),
});
const productBody = z.object({
  ...baseItem,
  sku: optionalText(60),
  trackStock: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).nullish(),
  attributes: z
    .record(z.string().max(50), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))
    .nullish(),
});
const listQuery = paginationQuerySchema.extend({
  search: z.string().max(100).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  category: z.string().max(80).optional(),
});

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/services',
    { preValidation: company('catalog:read'), schema: { querystring: listQuery } },
    async (request) => catalog.listServices(scopeFromRequest(request), request.query),
  );
  app.post(
    '/services',
    { preValidation: company('catalog:write'), schema: { body: serviceBody } },
    async (request, reply) =>
      reply.status(201).send(await catalog.createService(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/services/:id',
    {
      preValidation: company('catalog:write'),
      schema: { params: idParamSchema, body: patchSchema(serviceBody) },
    },
    async (request) =>
      catalog.updateService(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/services/:id',
    { preValidation: company('catalog:write'), schema: { params: idParamSchema } },
    async (request) => {
      await catalog.deleteService(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );

  app.get(
    '/products',
    { preValidation: company('catalog:read'), schema: { querystring: listQuery } },
    async (request) => catalog.listProducts(scopeFromRequest(request), request.query),
  );
  app.post(
    '/products',
    { preValidation: company('catalog:write'), schema: { body: productBody } },
    async (request, reply) =>
      reply.status(201).send(await catalog.createProduct(scopeFromRequest(request), request.body)),
  );
  app.patch(
    '/products/:id',
    {
      preValidation: company('catalog:write'),
      schema: { params: idParamSchema, body: patchSchema(productBody) },
    },
    async (request) =>
      catalog.updateProduct(scopeFromRequest(request), request.params.id, request.body),
  );
  app.delete(
    '/products/:id',
    { preValidation: company('catalog:write'), schema: { params: idParamSchema } },
    async (request) => {
      await catalog.deleteProduct(scopeFromRequest(request), request.params.id);
      return { ok: true };
    },
  );
};
