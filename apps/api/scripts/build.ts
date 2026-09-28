/**
 * Build de produção da API e do worker: empacota o código dos pacotes internos (@botsaas/*,
 * distribuídos como TypeScript) e mantém as dependências npm como externas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const workspaceDirs = [
  'apps/api',
  ...fs.readdirSync(path.join(ROOT, 'packages')).map((dir) => `packages/${dir}`),
];

const external = new Set<string>();
for (const dir of workspaceDirs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!name.startsWith('@botsaas/')) external.add(name);
  }
}

await build({
  entryPoints: {
    main: 'src/main.ts',
    worker: 'src/worker.ts',
    'bootstrap-owner': 'src/bootstrap-owner.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, '@prisma/client/*', 'pino-pretty'],
  banner: {
    // Compatibilidade para dependências CommonJS dentro do bundle ESM.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
