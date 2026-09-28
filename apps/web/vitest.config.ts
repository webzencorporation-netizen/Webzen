import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os cenários de navegador em e2e/ pertencem exclusivamente ao Playwright.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
  },
});
