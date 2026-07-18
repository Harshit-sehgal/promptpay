// Instrumentation executes before Nest ConfigModule; load .env at this earliest
// boundary so a local SENTRY_DSN is visible before any application imports.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

import { sentryBeforeBreadcrumb, sentryBeforeSend } from './common/utils/sentry-scrubber';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    integrations: [nodeProfilingIntegration()],
    // Performance monitoring
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    profileSessionSampleRate: environment === 'production' ? 0.1 : 1.0,
    // Ignore 4xx client errors — these are expected and not actionable.
    // The beforeBreadcrumb filter drops breadcrumbs whose `data` would leak
    // raw Error objects (from console.* in main.ts) or Prisma query text into
    // Sentry before beforeSend runs over the captured event.
    beforeBreadcrumb: sentryBeforeBreadcrumb,
    beforeSend: sentryBeforeSend,
  });
} else {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[Sentry] SENTRY_DSN is not configured — errors will not be captured in production.',
    );
  }
}
