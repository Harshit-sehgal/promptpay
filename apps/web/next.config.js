/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const { withSentryConfig } = require('@sentry/nextjs');
const path = require('path');

  /**
   * Security headers applied to every response (both page and API routes).
   *
   * CSP: script-src 'self' is the strongest policy the current app can support
   *      today — Google Identity Services requires loading accounts.google.com/gsi/client.
   *      We allow that origin explicitly rather than using a nonce or hash approach
   *      (GIS dynamically injects script). Once the GIS integration is replaced,
   *      tighten script-src to 'self' only.
   *
   *      frame-src: Google Identity Services renders its account-picker popup and
   *      the One-Tap prompt inside a cross-origin iframe at accounts.google.com.
   *      Without this, the Google button cannot complete sign-in under the
   *      production CSP (A-018). We scope it to exactly that origin.
   *
   * frame-ancestors 'none': equivalent to X-Frame-Options: DENY — prevents
   *      clickjacking of all WaitLayer pages (auth, dashboard, admin).
   *
   * X-Content-Type-Options: nosniff — prevents MIME-type sniffing attacks.
   *
   * Referrer-Policy: strict-origin-when-cross-origin — sends full referrer to
   *      same-origin, origin-only to cross-origin HTTPS (nothing to HTTP).
   *      This is the modern safe default.
   *
   * Permissions-Policy: explicitly disables camera, microphone, geolocation —
   *      WaitLayer has no use case for any of these, so we deny them by default.
   *
   * Strict-Transport-Security: max-age=63072000 (2 years), includeSubDomains.
   *      In production behind TLS termination, this tells browsers to always use
   *      HTTPS for this domain. `includeSubDomains` covers *.waitlayer.com.
   */
  const SECURITY_HEADERS = [
    {
      key: 'Content-Security-Policy',
      value:
        "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.sentry.io; frame-src 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
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
];

const nextConfig = {
  transpilePackages: ['@waitlayer/ui', '@waitlayer/shared', '@waitlayer/config'],
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),

  images: {
    remotePatterns: [
      // TOTP QR codes rendered via Google Chart API on the 2FA settings page
      { protocol: 'https', hostname: 'chart.googleapis.com' },
    ],
  },

  async headers() {
    return [
      {
        source: '/((?!_next).*)', // all routes except Next.js internal assets
        headers: SECURITY_HEADERS,
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
