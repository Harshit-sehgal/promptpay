/**
 * Shared upstream-fetch helper for BFF route handlers.
 *
 * Every BFF → API call gets:
 *   - a bounded timeout (a hung API must not hang the web request),
 *   - `cache: 'no-store'` (the API responses are per-request auth/financial
 *     data and must never be served from a Next data cache),
 *   - a JSON content guard: `res.json()` on an HTML/error-proxy response
 *     would throw and surface as a 500 instead of the real upstream status.
 */
export const BFF_API_TIMEOUT_MS = 15_000;

export type UpstreamResult = {
  /** True when the upstream responded 2xx. */
  ok: boolean;
  /** The upstream HTTP status (0 when the request timed out/failed). */
  status: number;
  /** Parsed JSON body, or null when the body was empty/non-JSON. */
  data: unknown;
};

/**
 * Maps an upstream status to a valid HTTP response status. `fetchApiJson`
 * reports network failures/timeouts as status 0; route handlers must not
 * pass that through to a real response, where it is meaningless. 502 Bad
 * Gateway keeps the A-049 contract (upstream unreachable is a retryable
 * failure, not a silent success).
 */
export function upstreamStatus(status: number): number {
  return status >= 100 && status <= 599 ? status : 502;
}

/**
 * Error codes that guarantee the request never reached the API application.
 *
 * Retrying is only safe when we know the upstream never saw the request:
 * `fetchApiJson` is used by signup, refresh and logout, so replaying a request
 * that *might* have been processed could create a second account or burn a
 * refresh token twice. A failure to establish the connection at all carries no
 * such risk — no bytes reached the application.
 *
 * Deliberately excluded: `ECONNRESET`, `UND_ERR_SOCKET` and friends. Those can
 * fire after the request was written, so they are ambiguous and must surface as
 * a 502 rather than be replayed.
 */
const RETRYABLE_CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** One extra attempt: enough for a cold upstream, bounded for a dead one. */
const CONNECT_RETRY_ATTEMPTS = 1;
const CONNECT_RETRY_DELAY_MS = 250;

/** Walk the `cause` chain — undici wraps the real error in `TypeError: fetch failed`. */
function connectErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attemptFetch(url: string, init: RequestInit): Promise<UpstreamResult | Error> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BFF_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    const data =
      contentType.includes('application/json') && text ? (JSON.parse(text) as unknown) : null;
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Record why an upstream call failed, server-side only.
 *
 * The caller receives a deliberately opaque "Upstream API unavailable" — the
 * browser must not learn about our network topology. But that opacity also made
 * a real production incident undiagnosable: sign-in returned 502 while the API
 * was demonstrably healthy, and nothing anywhere recorded the underlying cause.
 * Sentry would not have helped either; SENTRY_DSN is unset in production.
 *
 * Only the origin is logged, never the full URL — auth paths carry tokens in
 * the query string on some providers, and this line goes to a shared log.
 */
function logUpstreamFailure(url: string, error: Error, timedOut: boolean, attempts: number): void {
  let origin = 'unparseable-url';
  try {
    origin = new URL(url).origin;
  } catch {
    // keep the placeholder — a malformed URL is itself the useful signal
  }

  console.error(
    '[bff] upstream call failed',
    JSON.stringify({
      origin,
      reason: timedOut ? 'timeout' : 'connect',
      code: connectErrorCode(error) ?? 'unknown',
      name: error.name,
      message: error.message,
      attempts: attempts + 1,
      timeoutMs: BFF_API_TIMEOUT_MS,
    }),
  );
}

export async function fetchApiJson(url: string, init: RequestInit = {}): Promise<UpstreamResult> {
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await attemptFetch(url, init);
    if (!(outcome instanceof Error)) return outcome;

    const timedOut = outcome.name === 'AbortError';
    const canRetry =
      !timedOut &&
      attempt < CONNECT_RETRY_ATTEMPTS &&
      RETRYABLE_CONNECT_CODES.has(connectErrorCode(outcome) ?? '');

    if (!canRetry) {
      logUpstreamFailure(url, outcome, timedOut, attempt);
      return {
        ok: false,
        status: 0,
        data: { message: timedOut ? 'Upstream API timed out' : 'Upstream API unavailable' },
      };
    }

    await delay(CONNECT_RETRY_DELAY_MS);
  }
}
