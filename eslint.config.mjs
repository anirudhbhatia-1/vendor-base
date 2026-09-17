import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const ignoredPaths = [
  '**/.git/**',
  '**/.gstack/**',
  '**/.next/**',
  '**/.expo/**',
  '**/.pnpm-store/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/coverage/**',
  '**/test-results/**',
  '**/playwright-report/**',
  '**/outputs/**',
  '**/design-handoff/**',
];

export default tseslint.config(
  { ignores: ignoredPaths },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-warning-comments': ['warn', { terms: ['fixme'], location: 'anywhere' }],
    },
  },
  {
    files: [
      'eslint.config.mjs',
      'tooling/**/*.mjs',
      'apps/*/scripts/**/*.mjs',
      'database/scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Operator command-line tools. Their output *is* the interface, so the
    // structured-logging rule that applies to services does not apply here.
    files: ['tooling/scripts/**', 'database/scripts/**', 'apps/*/scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['apps/*/src/app.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    // Phase 12.2: automated accessibility gate on the customer-facing PWA
    // surfaces. Real screen-reader / assistive-technology passes remain a
    // deferred manual step recorded in the launch register; this catches the
    // static a11y regressions (missing labels, roles, keyboard handlers) that
    // do not need a device to find.
    files: ['apps/*-pwa/app/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
);
