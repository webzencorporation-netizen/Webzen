import type { AppContainer } from './container';
import type { AuthContext, TenantContext } from './context';

import type { ApiKeyContext } from './modules/developer/api-keys';

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    tenant: TenantContext | null;
    rawBody?: Buffer;
    /** Preenchido pelo guard `apiKey` nas rotas da API pública v1. */
    apiKeyContext?: ApiKeyContext;
  }
}
