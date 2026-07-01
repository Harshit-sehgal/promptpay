/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@waitlayer/ui', '@waitlayer/shared', '@waitlayer/config'],
  experimental: {
    typedRoutes: true,
  },
};

module.exports = nextConfig;
