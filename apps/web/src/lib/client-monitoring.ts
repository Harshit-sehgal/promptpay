'use client';

import * as Sentry from '@sentry/nextjs';

import { hasCurrentMarketingConsent } from './consent-preferences';

let initialized = false;

function initClientMonitoring(): void {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn) return;
  const environment =
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
    process.env.SENTRY_ENVIRONMENT ||
    process.env.NODE_ENV ||
    'development';

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'production' ? 0.05 : 0.5,
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 0.1,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Network request failed',
      'Failed to fetch',
      'Load failed',
    ],
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
  initialized = true;
}

/** Start optional client telemetry only after the current policy version is proven. */
export async function initializeMonitoringFromStoredConsent(): Promise<void> {
  if (typeof window === 'undefined' || initialized) return;
  try {
    const response = await fetch('/api/consent/required-versions', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const required = (await response.json()) as Record<string, string>;
    const version = required.marketing_cookies;
    if (version && hasCurrentMarketingConsent(version)) initClientMonitoring();
  } catch {
    // Fail closed: no policy verification means no optional telemetry.
  }
}

export function enableClientMonitoring(requiredVersion: string): void {
  if (typeof window !== 'undefined' && hasCurrentMarketingConsent(requiredVersion)) {
    initClientMonitoring();
  }
}

export function disableClientMonitoring(): void {
  if (!initialized) return;
  initialized = false;
  void Sentry.close(2_000);
}
