import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the consent boundary for OPTIONAL client telemetry.
 *
 * `sentry.client.config.ts` is the file Sentry's Next.js plugin injects into
 * the client bundle. It once called `Sentry.init()` directly whenever a DSN was
 * present, which started trace sampling and Session Replay before the visitor
 * answered the cookie banner, and kept it running after a "decline". The gate
 * in `lib/client-monitoring.ts` existed and was unit-tested, but nothing called
 * it, so the defect was invisible to every behavioural test.
 *
 * These are source-level assertions on purpose: the defect was the ABSENCE of a
 * call, which a mock-based test of the module cannot see.
 */
const webSrc = join(__dirname, '..');
const read = (p: string) => readFileSync(join(webSrc, p), 'utf8');

/**
 * Assertions run against CODE, not prose: the file documents the defect it
 * fixes, so its comments legitimately mention `Sentry.init()` and would
 * otherwise trip the very check that is meant to catch a real call.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('optional client telemetry stays behind consent', () => {
  it('the injected Sentry client config never initialises directly', () => {
    const config = code('sentry.client.config.ts');
    expect(config).not.toMatch(/Sentry\.init\s*\(/);
    expect(config).not.toMatch(/replaysSessionSampleRate/);
  });

  it('the injected Sentry client config routes through the consent gate', () => {
    expect(code('sentry.client.config.ts')).toMatch(/initializeMonitoringFromStoredConsent\s*\(/);
  });

  it('only the consent-gated module owns the client Sentry.init call', () => {
    const monitoring = code('lib/client-monitoring.ts');
    expect(monitoring).toMatch(/Sentry\.init\s*\(/);
    // The init is reachable only after a version-checked consent read.
    expect(monitoring).toMatch(/hasCurrentMarketingConsent/);
  });

  it('the cookie banner applies the choice to telemetry immediately', () => {
    const banner = code('components/cookie-consent.tsx');
    expect(banner).toMatch(/enableClientMonitoring/);
    expect(banner).toMatch(/disableClientMonitoring/);
  });
});
