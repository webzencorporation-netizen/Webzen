/** Carrega os bundles sem conectar à infraestrutura nem usar credenciais externas. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const API_DIR = path.resolve(import.meta.dirname, '..');

for (const entry of ['main', 'worker']) {
  const result = spawnSync(process.execPath, [`dist/${entry}.js`], {
    cwd: API_DIR,
    encoding: 'utf8',
    timeout: 15_000,
    // A configuração inválida deve ser recusada ANTES de abrir banco/Redis.
    // Se faltar uma dependência do bundle, o carregamento falha antes dessa validação.
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://unused:unused@localhost:1/unused',
      AI_PROVIDER: 'mock',
      WHATSAPP_PROVIDER: 'mock',
      LOG_LEVEL: 'silent',
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, `${entry}: esperado bloqueio de configuração de produção`);
  assert.match(result.stderr, /AI_PROVIDER=mock não é permitido em produção/, result.stderr);
  assert.match(result.stderr, /WHATSAPP_PROVIDER=mock não é permitido em produção/, result.stderr);
  process.stdout.write(`${entry}: bundle carregado; mocks recusados em produção\n`);
}

// O bootstrap independe dos providers e exige DATABASE_URL explícita antes de conectar.
// Não herdar credenciais de bootstrap nem a URL do banco do ambiente do operador.
const bootstrap = spawnSync(process.execPath, ['dist/bootstrap-owner.js'], {
  cwd: API_DIR,
  encoding: 'utf8',
  timeout: 15_000,
  env: { NODE_ENV: 'production' },
});
assert.ifError(bootstrap.error);
assert.equal(bootstrap.status, 1, 'bootstrap-owner: esperado bloqueio sem DATABASE_URL');
assert.match(bootstrap.stderr, /DATABASE_URL explícita é obrigatória/, bootstrap.stderr);
process.stdout.write('bootstrap-owner: bundle carregado; DATABASE_URL ausente recusada\n');
