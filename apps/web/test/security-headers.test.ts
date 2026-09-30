import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../security-headers';

const byKey = (production: boolean) =>
  Object.fromEntries(securityHeaders(production).map((header) => [header.key, header.value]));

describe('cabeçalhos de segurança do painel', () => {
  it('produção: CSP restrita à própria origem, sem framing, e HSTS', () => {
    const headers = byKey(true);
    const csp = headers['Content-Security-Policy'] ?? '';
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ])
      expect(csp).toContain(directive);
    expect(csp).not.toMatch(/unsafe-eval|\*|https?:/);
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('desenvolvimento: sem CSP/HSTS (o Next precisa de eval e HTTP), mantendo o restante', () => {
    const headers = byKey(false);
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
});
