import { describe, expect, it } from 'vitest';
import { findSecrets } from '../../../scripts/check-secrets';

// Valores falsos montados por concatenação: este arquivo não pode ele mesmo parecer um segredo.
const fake = {
  anthropic: 'sk-' + 'ant-' + 'a'.repeat(40),
  meta: 'LLM_' + '1234567890' + '_' + 'b'.repeat(24),
  whatsapp: 'EAA' + 'G'.repeat(60),
  neon: 'npg_' + 'c'.repeat(12),
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  github: 'ghp_' + 'd'.repeat(36),
  key: '-----BEGIN ' + 'PRIVATE KEY-----',
  dbUrl: 'postgresql://app:' + 'e'.repeat(16) + '@db.example.com/app',
};

describe('verificador de segredos', () => {
  it('encontra cada tipo de chave e informa só arquivo, linha e tipo', () => {
    const content = Object.values(fake)
      .map((value) => `const x = "${value}";`)
      .join('\n');
    const findings = findSecrets('src/config.ts', content);
    expect(findings.map((item) => item.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(JSON.stringify(findings)).not.toContain(fake.anthropic);
  });

  it('bloqueia arquivos .env versionados, mas permite o .env.example', () => {
    expect(findSecrets('.env', '')).toEqual([
      { file: '.env', line: 0, kind: 'Arquivo .env versionado' },
    ]);
    expect(findSecrets('apps/api/.env.production', '')).toHaveLength(1);
    expect(findSecrets('.env.example', 'ANTHROPIC_API_KEY=\n')).toEqual([]);
  });

  it('não acusa placeholders nem URLs locais de desenvolvimento', () => {
    const content = [
      'DATABASE_URL=postgresql://botsaas:botsaas@localhost:5432/botsaas',
      'DATABASE_URL=postgresql://user:***@host/db',
      'const token = `EAAG${"k".repeat(60)}`;',
      'ANTHROPIC_API_KEY=',
    ].join('\n');
    expect(findSecrets('docs/example.md', content)).toEqual([]);
  });
});
