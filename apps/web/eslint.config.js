const baseConfig = require('@waitlayer/eslint-config');
const nextConfig = require('eslint-config-next');

module.exports = [
  ...baseConfig,
  ...nextConfig,
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];
