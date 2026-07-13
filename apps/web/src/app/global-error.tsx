'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    if (process.env.NODE_ENV === 'development') {
      console.error(error);
    }
  }, [error]);

  // `global-error.tsx` replaces the root layout when a *critical* error
  // happens during root-layout render itself, so the normal layout `<head>`
  // is never produced. The runtime CSP header from `next.config.js headers()`
  // still applies to the response, but it depends on Next's header pipeline
  // firing — if that ever regresses (a moved `source` glob, a proxy that
  // strips headers) the error page would ship with zero CSP. An inline
  // `<meta http-equiv="Content-Security-Policy">` mirrors the policy from
  // next.config.js as defense-in-depth so the page is locked down regardless
  // of whether the HTTP header lands. (Browsers combine the header and meta
  // with the most restrictive policy winning, so an extra meta can only
  // tighten — never loosen — what next.config.js already enforces.)
  const CSP_META =
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.sentry.io; frame-src 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta httpEquiv="Content-Security-Policy" content={CSP_META} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <title>Something went wrong</title>
      </head>
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: '#fafafa',
            color: '#171717',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h2
              style={{
                fontSize: '24px',
                fontWeight: 700,
                marginBottom: '8px',
                color: '#171717',
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                fontSize: '14px',
                color: '#737373',
                marginBottom: '24px',
                lineHeight: 1.5,
              }}
            >
              A critical error occurred. Please try refreshing the page.
            </p>
            <button
              onClick={reset}
              style={{
                backgroundColor: '#0f766e',
                color: 'white',
                fontWeight: 500,
                padding: '10px 24px',
                borderRadius: '12px',
                fontSize: '14px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
