import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
  process.env.SENTRY_ENVIRONMENT ||
  process.env.NODE_ENV ||
  'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    // Performance monitoring — lower sample rate on client to save quota
    tracesSampleRate: environment === 'production' ? 0.05 : 0.5,
    replaysSessionSampleRate: 0.01, // Session Replay: 1% of sessions
    replaysOnErrorSampleRate: 0.1, // Replay on error: 10% of errors
    // Ignore common browser extensions / noise
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Network request failed',
      'Failed to fetch',
      'Load failed',
    ],
    // Filter out resolved 4xx errors (e.g. 401 on expired token)
    // PII scrub: strip email addresses, names, and raw API creds from
    // exception messages/values before they leave the client. The source
    // is the user's browser — anything an API rejection echoes back (or a
    // user typed into a form that ended up in an Error message) could carry
    // PII. A regex scrub here is a defense-in-depth layer; the server-side
    // Sentry config already applies status-based filtering.
    beforeSend(event) {
      if (event.exception?.values) {
        for (const val of event.exception.values) {
          if (typeof val.value === 'string') {
            val.value = val.value
              .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email-redacted]')
              .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[name-redacted]');
          }
          if (typeof val.type === 'string') {
            val.type = val.type.replace(
              /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
              '[email-redacted]',
            );
          }
        }
      }
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
