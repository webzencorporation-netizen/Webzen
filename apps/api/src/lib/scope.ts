import { createTenantClient } from '@botsaas/database';
import { permissionsForRole } from '@botsaas/shared';
import type { FastifyRequest } from 'fastify';
import type { AppContainer } from '../container';
import type { Actor, CompanyScope } from '../context';
import { requireTenant } from '../plugins/guards';

/** Escopo da empresa a partir de uma requisição autenticada (após o guard `company`). */
export function scopeFromRequest(request: FastifyRequest): CompanyScope {
  return { ...requireTenant(request), container: request.server.container };
}

/**
 * Escopo para processos internos (jobs, webhooks, agente). A empresa vem de um registro
 * confiável do banco (ex.: número do WhatsApp), nunca de entrada do usuário.
 */
export function systemScope(
  container: AppContainer,
  companyId: string,
  actor: Actor = { type: 'SYSTEM', label: 'Sistema' },
): CompanyScope {
  return {
    companyId,
    db: createTenantClient(companyId),
    actor,
    role: null,
    permissions: new Set(permissionsForRole('COMPANY_OWNER')),
    isSupportMode: false,
    container,
  };
}
