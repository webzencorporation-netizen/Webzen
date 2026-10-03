import type { FastifyInstance, RouteOptions } from 'fastify';
import { guardInfo, type GuardInfo } from './guards';

/**
 * Inventário de endpoints: cada rota registrada com os guards (autenticação/permissão) que
 * a protegem. O teste `route-inventory.test.ts` impõe a política sobre ele — uma rota nova
 * sem guard quebra o teste em vez de ir para produção desprotegida.
 */
export interface RouteInventoryEntry {
  method: string;
  url: string;
  guards: GuardInfo[];
}

declare module 'fastify' {
  interface FastifyInstance {
    routeInventory: RouteInventoryEntry[];
  }
}

function hooksOf(value: RouteOptions['preValidation'] | RouteOptions['preHandler']): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** Deve ser chamado antes de registrar as rotas. */
export function registerRouteInventory(app: FastifyInstance): void {
  const inventory: RouteInventoryEntry[] = [];
  app.decorate('routeInventory', inventory);
  app.addHook('onRoute', (route) => {
    const guards = [...hooksOf(route.preValidation), ...hooksOf(route.preHandler)]
      .map(guardInfo)
      .filter((info): info is GuardInfo => info !== undefined);
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      inventory.push({ method, url: route.url, guards });
    }
  });
}
