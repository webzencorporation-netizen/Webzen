import type { FastifyPluginAsync } from 'fastify';
import { contactRoutes } from './contacts/routes';

/**
 * Painel da EMPRESA (/api/app/*). A empresa vem da sessão (guard `company`);
 * nenhuma rota aceita companyId do cliente.
 */
export const companyRoutes: FastifyPluginAsync = async (app) => {
  await app.register(contactRoutes, { prefix: '/contacts' });
};
