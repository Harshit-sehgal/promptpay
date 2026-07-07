import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    // Performance monitoring (adjust sampling rate in production)
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    // Spotlight is Sentry's local dev tool for debugging (no-op unless running)
    spotlight: process.env.NODE_ENV === 'development',
    // Ignore 4xx client errors (not actionable)
    beforeSend(event) {
      if (event.exception?.values?.[0]) {
        const value = event.exception.values[0];
        // Skip 4xx HTTP errors from upstream calls
        if (value.type === 'HttpException' || value.type?.includes('HttpException')) {
          const statusCode = (event.extra?.statusCode as number) || 0;
          if (statusCode >= 400 && statusCode < 500) return null;
        }
      }
      return event;
    },
  });
} else {
  // Warn in development, hard-fail in production on missing DSN
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Sentry] SENTRY_DSN is not configured — errors will not be captured in production. Set SENTRY_DSN to enable error monitoring.',
    );
  }
}
