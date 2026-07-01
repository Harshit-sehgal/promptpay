/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  transpilePackages: ['@waitlayer/ui', '@waitlayer/shared', '@waitlayer/config'],
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
