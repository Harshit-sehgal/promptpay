'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Honest disclosure of the platform's settlement state (A-089).
 *
 * `getWaitLaunchMode()` existed on the API from the start but was consumed
 * only by the extension's ad path. No web surface read it. The result: a
 * developer could sign up, land on an earnings dashboard showing zero, and
 * find nothing anywhere explaining that settlement is switched off and no
 * amount of usage will change that — while the marketing site talks about
 * earning. That is a consumer-protection problem, not a UX nicety.
 *
 * The three modes come straight from the API:
 *   - `earnings_enabled` — ads serve and settle. No banner; nothing to warn about.
 *   - `telemetry_only`   — wait detection runs, nothing accrues. The default,
 *                          and the honest state of the private beta.
 *   - `paused`           — ads are globally off.
 * `unknown` is used when the health contract cannot be read; it is reported as
 * such rather than being optimistically treated as enabled.
 */
export type WaitLaunchMode = 'earnings_enabled' | 'telemetry_only' | 'paused' | 'unknown';

interface LaunchModeState {
  mode: WaitLaunchMode;
  /** True until the first health response resolves, so callers can avoid a flash. */
  loading: boolean;
}

const VALID_MODES: WaitLaunchMode[] = ['earnings_enabled', 'telemetry_only', 'paused', 'unknown'];

/**
 * Read the platform launch mode from the public health contract.
 *
 * Fails closed: any error, timeout, or unrecognised value resolves to
 * `unknown`, never to `earnings_enabled`. A broken health endpoint must not be
 * able to make the product claim it pays people.
 */
export function useWaitLaunchMode(override?: WaitLaunchMode): LaunchModeState {
  const [mode, setMode] = useState<WaitLaunchMode>(override ?? 'unknown');
  const [loading, setLoading] = useState(override === undefined);

  useEffect(() => {
    if (override !== undefined) return;
    let active = true;
    void fetch('/api/platform-health', { cache: 'no-store' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('unavailable')),
      )
      .then((health: { waitLaunchMode?: string }) => {
        if (!active) return;
        const next = health.waitLaunchMode;
        setMode(
          typeof next === 'string' && (VALID_MODES as string[]).includes(next)
            ? (next as WaitLaunchMode)
            : 'unknown',
        );
      })
      .catch(() => {
        if (active) setMode('unknown');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [override]);

  return { mode, loading };
}

/** True when the platform can actually settle earnings right now. */
export function earningsAreLive(mode: WaitLaunchMode): boolean {
  return mode === 'earnings_enabled';
}

const COPY: Record<
  Exclude<WaitLaunchMode, 'earnings_enabled'>,
  { title: string; body: string; tone: string }
> = {
  telemetry_only: {
    title: 'Private beta — wait detection only, no earnings',
    body:
      'Your wait states are being verified, but settlement is switched off, so no earnings ' +
      'accrue and advertisers are not billed. Rewards stay disabled until an independently ' +
      'verifiable wait attestation is deployed and reviewed.',
    tone: 'border-sky-300 bg-sky-50 text-sky-950',
  },
  paused: {
    title: 'Ad serving is paused',
    body:
      'The platform operator has paused ad serving. Wait detection may continue, but no ' +
      'placements are served and nothing accrues while this is in effect.',
    tone: 'border-amber-300 bg-amber-50 text-amber-950',
  },
  unknown: {
    title: 'Platform status unavailable',
    body:
      'We could not confirm whether settlement is enabled. Treat earnings figures as ' +
      'unverified until this resolves.',
    tone: 'border-surface-300 bg-surface-100 text-surface-900',
  },
};

export function LaunchModeBanner({ override }: { override?: WaitLaunchMode } = {}) {
  const { mode, loading } = useWaitLaunchMode(override);

  // Render nothing while loading rather than flashing a warning that may not
  // apply, and nothing at all once earnings are genuinely live.
  if (loading || mode === 'earnings_enabled') return null;

  const copy = COPY[mode];
  return (
    <div
      role="status"
      aria-label={copy.title}
      className={`mb-6 rounded-xl border px-4 py-3 text-sm ${copy.tone}`}
    >
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1 leading-relaxed opacity-90">{copy.body}</p>
      <Link
        href="/payout-policy"
        className="mt-2 inline-block text-xs font-medium underline underline-offset-2"
      >
        Read the payout policy →
      </Link>
    </div>
  );
}
