/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const { withSentryConfig } = require('@sentry/nextjs');
const path = require('path');

const { buildCsp } = require('./src/lib/csp.js');

/**
 * Security headers applied to every response (both page and API routes).
 *
 * CSP notes:
 *  - script-src / style-src keep 'unsafe-inline'. Next.js injects inline
 *    bootstrap / Flight / React-refresh scripts that are NOT stamped with a
 *    nonce, so a nonce-only policy would block hydration (the page renders
 *    SSR HTML but is never interactive). A per-request nonce was tried and
 *    explicitly broke client-side hydration.
 *  - 'unsafe-eval' is added only in development (required for React Fast
 *    Refresh / HMR). Production CSP keeps it out.
 *  - frame-src 'self' https://accounts.google.com allows the Google Identity
 *    Services account-picker popup.
 *  - connect-src allows the Sentry ingest endpoint.
 */
function securityHeaders() {
  return [
    {
      key: 'Content-Security-Policy',
      value: buildCsp(),
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
  ];
}

/**
 * Bundler note: `package.json` builds with `next build --webpack`.
 *
 * Next 16 defaults `next build` to Turbopack, and under Vercel's build the
 * Turbopack path does not emit `.next/next-server.js.nft.json`. Vercel's
 * `onBuildComplete` hook reads that file, so the build fails after reporting
 * "Compiled successfully". Deploys appeared healthy only while the restored
 * build cache still carried the file from an older build — the first full
 * rebuild (2.2s incremental → 19.9s cold) broke every deployment after it.
 * `dev` already runs on webpack for the Sentry webpack options below.
 */
const nextConfig = {
  transpilePackages: ['@ateva/ui', '@ateva/shared', '@ateva/config'],
  output: 'standalone',
  typedRoutes: true,
  crossOrigin: 'anonymous',
  experimental: { sri: { algorithm: 'sha384' } },
  outputFileTracingRoot: path.join(__dirname, '../../'),

  async headers() {
    // Apply to all app routes except Next.js internal assets.
    return [
      {
        source: '/((?!_next).*)',
        headers: securityHeaders(),
      },
    ];
  },

  async redirects() {
    return [
      {
        source: '/apply',
        destination: '/auth/signup?role=developer',
        permanent: false,
      },
    ];
  },
};

// Wrap with Sentry config — only active when SENTRY_DSN is set (no-op otherwise)
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Source maps are uploaded only when an auth token is provided (CI/CD builds)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientUpload: true,
  // Disable tunnel in favor of direct browser→Sentry transport (simpler CSP)
  tunnelRoute: undefined,
  // Hide source maps from non-Sentry endpoints
  hideSourceMaps: true,
  webpack: {
    automaticVercelMonitors: true,
  },
});
