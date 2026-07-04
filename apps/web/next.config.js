/** @type {import('next').NextConfig} */
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
      "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
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

  async headers() {
    return [
      {
        source: '/((?!_next).*)', // all routes except Next.js internal assets
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;