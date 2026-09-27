import { APPOINTMENT_STATUSES } from '@botsaas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, optionalText } from '../../../lib/http';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import * as calendar from '../../calendar/service';
import { feature } from '../../features/service';

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = [company('calendar:read'), feature('CALENDAR')];
  const write = [company('calendar:write'), feature('CALENDAR')];

  app.get(
    '/appointments',
    {
      preValidation: read,
      schema: {
        querystring: z
          .object({
            from: z.coerce.date(),
            to: z.coerce.date(),
            status: z.enum(APPOINTMENT_STATUSES).optional(),
            contactId: z.uuid().optional(),
          })
          .refine(
            (value) =>
              value.to > value.from &&
              value.to.getTime() - value.from.getTime() <= 93 * 24 * 3600_000,
            'Período inválido (máx. 93 dias)',
          ),
      },
    },
    async (request) => calendar.listAppointments(scopeFromRequest(request), request.query),
  );

  app.get(
    '/availability',
    {
      preValidation: read,
      schema: {
        querystring: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          days: z.coerce.number().int().min(1).max(14).default(1),
          serviceId: z.uuid().optional(),
        }),
      },
    },
    async (request) => calendar.getAvailableSlots(scopeFromRequest(request), request.query),
  );

  app.post(
    '/appointments',
    {
      preValidation: write,
      schema: {
        body: z.object({
          contactId: z.uuid(),
          serviceId: z.uuid().nullish(),
          startAt: z.coerce.date(),
          endAt: z.coerce.date().nullish(),
          notes: optionalText(1000),
          status: z.enum(['PENDING', 'CONFIRMED']).optional(),
          enforceAvailability: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await calendar.createAppointment(scopeFromRequest(request), request.body)),
  );

  app.post(
    '/appointments/:id/reschedule',
    {
      preValidation: write,
      schema: { params: idParamSchema, body: z.object({ startAt: z.coerce.date() }) },
    },
    async (request) =>
      calendar.rescheduleAppointment(
        scopeFromRequest(request),
        request.params.id,
        request.body.startAt,
      ),
  );

  app.post(
    '/appointments/:id/status',
    {
      preValidation: write,
      schema: {
        params: idParamSchema,
        body: z.object({ status: z.enum(APPOINTMENT_STATUSES), reason: optionalText(300) }),
      },
    },
    async (request) =>
      request.body.status === 'CANCELLED'
        ? calendar.cancelAppointment(
            scopeFromRequest(request),
            request.params.id,
            request.body.reason,
          )
        : calendar.updateAppointmentStatus(
            scopeFromRequest(request),
            request.params.id,
            request.body.status,
          ),
  );
};
