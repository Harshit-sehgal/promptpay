const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');
const simpleImportSort = require('eslint-plugin-simple-import-sort');

const config = [
  {
    ignores: ['dist/**', 'node_modules/**', '.next/**', 'out/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      // Enforce a consistent import order: side-effect imports, then external
      // (with `node:`-prefixed builtins first), then internal `@waitlayer/*`
      // and relative imports. Keeping this in the shared config means every
      // package sorts identically — see docs/STYLE_GUIDE.md.
      'simple-import-sort/imports': [
        'warn',
        {
          groups: [
            ['^\\u0000'],
            ['^(node:.*|node:.*|\\w.*)$', '\\w.*'],
            ['^@waitlayer/(.*)$'],
            ['^\\.\\.(.*)$', '^\\.(.*)$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
];

module.exports = config;
