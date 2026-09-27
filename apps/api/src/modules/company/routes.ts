import type { FastifyPluginAsync } from 'fastify';
import { aiRoutes } from './ai/routes';
import { auditRoutes } from './audit/routes';
import { automationRoutes } from './automations/routes';
import { calendarRoutes } from './calendar/routes';
import { catalogRoutes } from './catalog/routes';
import { contactRoutes } from './contacts/routes';
import { conversationRoutes } from './conversations/routes';
import { crmRoutes } from './crm/routes';
import { integrationRoutes } from './integrations/routes';
import { knowledgeRoutes } from './knowledge/routes';
import { metricsRoutes } from './metrics/routes';
import { notificationRoutes } from './notifications/routes';
import { exportRoutes } from './privacy/routes';
import { searchRoutes } from './search/routes';
import { settingsRoutes } from './settings/routes';
import { teamRoutes } from './team/routes';

/**
 * Painel da EMPRESA (/api/app/*). A empresa vem da sessão (guard `company`);
 * nenhuma rota aceita companyId do cliente.
 */
export const companyRoutes: FastifyPluginAsync = async (app) => {
  await app.register(settingsRoutes, { prefix: '/company' });
  await app.register(teamRoutes, { prefix: '/team' });
  await app.register(contactRoutes, { prefix: '/contacts' });
  await app.register(conversationRoutes, { prefix: '/conversations' });
  await app.register(crmRoutes, { prefix: '/crm' });
  await app.register(catalogRoutes, { prefix: '/catalog' });
  await app.register(knowledgeRoutes, { prefix: '/knowledge' });
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(calendarRoutes, { prefix: '/calendar' });
  await app.register(integrationRoutes, { prefix: '/integrations' });
  await app.register(metricsRoutes, { prefix: '/metrics' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(automationRoutes, { prefix: '/automations' });
  await app.register(auditRoutes, { prefix: '/audit' });
  await app.register(exportRoutes, { prefix: '/exports' });
  await app.register(searchRoutes, { prefix: '/search' });
};
