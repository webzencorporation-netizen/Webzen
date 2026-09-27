import type { AppContainer } from './container';
import type { AuthContext, TenantContext } from './context';

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    tenant: TenantContext | null;
    rawBody?: Buffer;
  }
}
