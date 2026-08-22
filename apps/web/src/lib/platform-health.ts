/**
 * One `/api/platform-health` request per page, shared by every component that
 * needs it.
 *
 * Five components fetched it independently, each with `cache: 'no-store'`, so
 * nothing deduplicated them: two fired on the homepage for every anonymous
 * visitor and more on the dashboards. Each one crosses the BFF proxy and
 * reaches the API host, which is a 956 MB box measured at 33% CPU steal — so
 * the duplicates are not free.
 *
 * `no-store` is deliberate and kept: the point of this endpoint is liveness,
 * and a cached answer would report a dead API as healthy. Deduplication is done
 * here instead, where it can be bounded: concurrent callers share one in-flight
 * request, and a result is reused for TTL_MS so a page that mounts several of
 * these components still makes exactly one call.
 *
 * The result is deliberately a discriminated union rather than `T | null`.
 * Callers distinguish the two failure modes — `BackendStatus` reports a bad
 * HTTP status as "degraded" (the API answered, and it is unwell) and a network
 * failure as "unknown" (we cannot tell) — and collapsing them would lose that.
 */

export interface PlatformHealth {
  status?: string;
  database?: string;
  redis?: { status: string };
  environmentKind?: string;
  waitLaunchMode?: string;
  deposits?: { enabled?: boolean; processor?: string | null; ready?: boolean };
}

export type PlatformHealthResult =
  | { ok: true; data: PlatformHealth }
  /** The API answered with a non-2xx status — it is reachable but unwell. */
  | { ok: false; reason: 'http' }
  /** The request never completed — we cannot say anything about the API. */
  | { ok: false; reason: 'network' };

/** Long enough to collapse one page's mounts, short enough to stay liveness. */
const TTL_MS = 10_000;

let inFlight: Promise<PlatformHealthResult> | null = null;
let cached: { at: number; result: PlatformHealthResult } | null = null;

async function request(): Promise<PlatformHealthResult> {
  try {
    const res = await fetch('/api/platform-health', { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'http' };
    return { ok: true, data: (await res.json()) as PlatformHealth };
  } catch {
    // A body that fails to parse is as unusable as a socket that never opened;
    // both mean we hold no health data.
    return { ok: false, reason: 'network' };
  }
}

export async function getPlatformHealth(): Promise<PlatformHealthResult> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.result;
  if (inFlight) return inFlight;

  inFlight = request()
    .then((result) => {
      cached = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Test-only: drop the shared state so cases cannot leak into each other. */
export function resetPlatformHealthCache(): void {
  inFlight = null;
  cached = null;
}
