import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * O painel acessa a API pela mesma origem (/api/*) via rewrite: cookies de sessão
 * httpOnly + SameSite=Lax funcionam sem CORS e nenhum segredo chega ao navegador.
 */
const nextConfig: NextConfig = {
  // Permite rodar uma segunda instância isolada (ex.: testes E2E) sem conflitar com o dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@botsaas/shared'],
  experimental: {
    // O proxy do rewrite corta em 30 s por padrão (500 no painel). Um turno do agente com
    // raciocínio e várias tools passa disso (Testar agente); 180 s = lease do turno no runner.
    proxyTimeout: 180_000,
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'production') }];
  },
};

export default nextConfig;
