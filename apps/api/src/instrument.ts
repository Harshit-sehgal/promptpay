import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    integrations: [
      nodeProfilingIntegration(),
    ],
    // Performance monitoring
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    profileSessionSampleRate: environment === 'production' ? 0.1 : 1.0,
    // Ignore 4xx client errors — these are expected and not actionable
    beforeSend(event) {
      if (event.exception?.values?.[0]) {
        const value = event.exception.values[0];
        if (value.type === 'HttpException' || value.type?.includes('HttpException')) {
          const statusCode = (event.extra?.statusCode as number) || 0;
          if (statusCode >= 400 && statusCode < 500) return null;
        }
      }
      return event;
    },
  });
} else {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Sentry] SENTRY_DSN is not configured — errors will not be captured in production.',
    );
  }
}
