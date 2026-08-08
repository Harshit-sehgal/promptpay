// Instrumentation executes before Nest ConfigModule; load .env at this earliest
// boundary so a local SENTRY_DSN is visible before any application imports.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

import { sentryBeforeBreadcrumb, sentryBeforeSend } from './common/utils/sentry-scrubber';

/**
 * `@sentry/profiling-node` is a NATIVE addon (`@sentry/node-cpu-profiler`), and
 * a static import loads and initialises it on every boot — including the many
 * boots where Sentry is switched off entirely and it can never be used.
 *
 * This module is the first thing `main.ts` imports, so that native
 * initialisation sits at the very front of the startup path, ahead of any log
 * line. A-115 (an intermittent hang in exactly that window, with the main
 * thread parked on a futex while a second thread holds the event loop) is
 * consistent with a native module's thread setup, which makes loading it
 * unnecessarily a liability as well as waste.
 *
 * Requiring it only when a DSN is configured keeps the profiler fully
 * functional where it is actually used, and removes a native addon from the
 * startup path everywhere else. The module target is CommonJS, so a plain
 * `require` is the right tool and stays synchronous — Sentry must be
 * initialised before any application module is imported.
 */
// Derived from `Sentry.init`'s own options rather than a named export: the SDK
// does not export an `Integration` type, and deriving it here means this cannot
// drift when the SDK's type layout changes.
type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type SentryIntegration = Extract<SentryInitOptions['integrations'], readonly unknown[]>[number];

function loadProfilingIntegration(): SentryIntegration | null {
  try {
    const { nodeProfilingIntegration } = require('@sentry/profiling-node') as {
      nodeProfilingIntegration: () => SentryIntegration;
    };
    return nodeProfilingIntegration();
  } catch (error) {
    // Profiling is an optional extra. Losing it must never stop the API
    // booting, and on a platform with no prebuilt binary this is the only
    // thing standing between a missing profiler and a dead deploy.
    console.warn(
      `[Sentry] CPU profiling unavailable, continuing without it: ${(error as Error).message}`,
    );
    return null;
  }
}

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

if (dsn) {
  const profiling = loadProfilingIntegration();
  Sentry.init({
    dsn,
    environment,
    integrations: profiling ? [profiling] : [],
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
