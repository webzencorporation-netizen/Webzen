/**
 * Cabeçalhos de segurança do painel. CSP e HSTS só em produção: em desenvolvimento o Next usa
 * `eval` (Fast Refresh) e HTTP. O painel não carrega scripts, fontes nem imagens de terceiros
 * (a fonte é servida pelo próprio app via next/font) e fala com a API pela mesma origem.
 * `'unsafe-inline'` em script-src é exigido pelo bootstrap inline do Next sem nonce.
 */
export function securityHeaders(production: boolean): { key: string; value: string }[] {
  const base = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  if (!production) return base;
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  return [
    ...base,
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  ];
}
