const baseConfig = require('@waitlayer/eslint-config');
const nextPlugin = require('@next/eslint-plugin-next');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const path = require('path');

const nextPagesDir = path.resolve(__dirname, 'src/app');

module.exports = [
  ...baseConfig,
  {
    ignores: ['.next/**'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '19.0' },
      next: { pagesDir: nextPagesDir },
    },
  },
  {
    name: 'next/core-web-vitals',
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      '@next/next/no-html-link-for-pages': 'error',
      '@next/next/no-sync-scripts': 'error',
    },
  },
  {
    name: 'react-hooks',
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
