/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const { withSentryConfig } = require('@sentry/nextjs');
const path = require('path');

/**
 * Security headers applied to every response (both page and API routes).
 *
 * CSP notes:
 *  - script-src / style-src keep 'unsafe-inline'. Next.js injects inline
 *    bootstrap / Flight / React-refresh scripts that are NOT stamped with a
 *    nonce, so a nonce-only policy would block hydration (the page renders
 *    SSR HTML but is never interactive). A per-request nonce was tried and
 *    explicitly broke client-side hydration.
 *  - frame-src 'self' https://accounts.google.com allows the Google Identity
 *    Services account-picker popup.
 *  - connect-src allows the Sentry ingest endpoint.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.sentry.io; frame-src 'self' https://accounts.google.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests;",
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

const nextConfig = {
  transpilePackages: ['@waitlayer/ui', '@waitlayer/shared', '@waitlayer/config'],
  typedRoutes: true,
  crossOrigin: 'anonymous',
  experimental: { sri: { algorithm: 'sha384' } },
  outputFileTracingRoot: path.join(__dirname, '../../'),

  async headers() {
    // Apply to all app routes except Next.js internal assets.
    return [
      {
        source: '/((?!_next).*)',
        headers: SECURITY_HEADERS,
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
  widenClientFileUpload: true,
  // Disable tunnel in favor of direct browser→Sentry transport (simpler CSP)
  tunnelRoute: undefined,
  // Hide source maps from non-Sentry endpoints
  hideSourceMaps: true,
  webpack: {
    automaticVercelMonitors: true,
  },
});
