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

export async function fetchApiJson(url: string, init: RequestInit = {}): Promise<UpstreamResult> {
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
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: { message: timedOut ? 'Upstream API timed out' : 'Upstream API unavailable' },
    };
  } finally {
    clearTimeout(timeout);
  }
}
