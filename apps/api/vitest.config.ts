import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/helpers/global-setup.ts'],
    setupFiles: ['./test/helpers/setup-env.ts'],
    // Testes de integração compartilham o mesmo banco: execução sequencial por arquivo.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
