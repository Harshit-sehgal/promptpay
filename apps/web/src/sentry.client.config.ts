import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    // Performance monitoring — lower sample rate on client to save quota
    tracesSampleRate: environment === 'production' ? 0.05 : 0.5,
    replaysSessionSampleRate: 0.01,  // Session Replay: 1% of sessions
    replaysOnErrorSampleRate: 0.1,   // Replay on error: 10% of errors
    // Ignore common browser extensions / noise
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Network request failed',
      'Failed to fetch',
      'Load failed',
    ],
    // Filter out resolved 4xx errors (e.g. 401 on expired token)
    beforeSend(event) {
      if (event.exception?.values?.[0]) {
        const value = event.exception.values[0];
        if (value.type === 'FetchError' || value.type === 'AxiosError') {
          const status = (event.extra?.status as number) || 0;
          if (status === 401 || status === 403) return null;
        }
      }
      return event;
    },
  });
}
