import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { scopeFromRequest } from '../../../lib/scope';
import { company } from '../../../plugins/guards';
import { exportContactsCsv, exportLeadsCsv, exportUsageCsv } from './service';

/** BOM UTF-8 para o Excel reconhecer acentos. */
const BOM = String.fromCharCode(0xfeff);

function sendCsv(reply: FastifyReply, name: string, csv: string) {
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header(
      'Content-Disposition',
      `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    )
    .send(`${BOM}${csv}`);
}

export const exportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/contacts.csv', { preValidation: company('contacts:export') }, async (request, reply) =>
    sendCsv(reply, 'contatos', await exportContactsCsv(scopeFromRequest(request))),
  );
  app.get('/crm.csv', { preValidation: company('contacts:export') }, async (request, reply) =>
    sendCsv(reply, 'crm', await exportLeadsCsv(scopeFromRequest(request))),
  );
  app.get('/usage.csv', { preValidation: company('usage:read') }, async (request, reply) =>
    sendCsv(reply, 'consumo', await exportUsageCsv(scopeFromRequest(request))),
  );
};
