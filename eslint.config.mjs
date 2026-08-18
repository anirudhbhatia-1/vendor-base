import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const ignoredPaths = [
  '**/.git/**',
  '**/.gstack/**',
  '**/.next/**',
  '**/.expo/**',
  '**/.pnpm-store/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/test-results/**',
  '**/playwright-report/**',
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
    files: ['eslint.config.mjs', 'tooling/**/*.mjs', 'apps/*/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['apps/*/src/app.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
);
