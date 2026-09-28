// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/database/src/generated/**',
      '.local/**',
      'storage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Módulos de empresa NUNCA usam o client sem escopo de tenant.
    files: ['apps/api/src/modules/company/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@botsaas/database',
              importNames: ['systemDb'],
              message:
                'Use o client com escopo de empresa (request.db / ctx.db). systemDb ignora o isolamento multi-tenant.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/web/screenshots.mjs', 'apps/web/e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.ts', '**/seed.ts', '**/seed/**/*.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
