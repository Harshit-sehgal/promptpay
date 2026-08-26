import { initializeMonitoringFromStoredConsent } from '@/lib/client-monitoring';

/**
 * Client telemetry is OPTIONAL analytics, and the cookie banner says so — it
 * offers "essential cookies to keep you signed in and optional analytics
 * cookies to improve". Sentry here carries `tracesSampleRate` and Session
 * Replay, which is squarely the optional half.
 *
 * This file used to call `Sentry.init()` directly whenever a DSN was present,
 * so replay could start sampling before the visitor answered the banner — and
 * regardless of a "decline". `lib/client-monitoring.ts` was written and
 * unit-tested to gate exactly that, but nothing ever called it.
 *
 * The init now lives behind that gate. It verifies the stored choice against
 * the server's *current* required policy version, so a stale acceptance of a
 * superseded policy does not silently keep telemetry alive, and it fails
 * closed: if the version cannot be verified, nothing starts.
 *
 * The banner calls `enableClientMonitoring` / `disableClientMonitoring`
 * directly, so a choice takes effect immediately rather than on next load.
 */
void initializeMonitoringFromStoredConsent();
