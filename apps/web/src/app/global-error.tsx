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

  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          backgroundColor: '#fafafa',
          color: '#171717',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 700,
              marginBottom: '8px',
              color: '#171717',
            }}>
              Something went wrong
            </h2>
            <p style={{
              fontSize: '14px',
              color: '#737373',
              marginBottom: '24px',
              lineHeight: 1.5,
            }}>
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
