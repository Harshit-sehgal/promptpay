import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchApiJson, upstreamStatus } from './upstream';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Shape undici uses: a generic TypeError wrapping the real cause. */
function fetchFailed(code: string): Error {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

function abortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

describe('fetchApiJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Runs the call while draining the retry delay, so fake timers do not deadlock. */
  async function run<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promise;
  }

  it('passes a JSON response straight through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    const result = await run(fetchApiJson('https://api.test/x'));
    expect(result).toEqual({ ok: true, status: 200, data: { ok: true } });
  });

  it('returns null data for a non-JSON body instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 502 })),
    );
    const result = await run(fetchApiJson('https://api.test/x'));
    expect(result).toEqual({ ok: false, status: 502, data: null });
  });

  it('retries once when the connection was refused, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(fetchFailed('ECONNREFUSED'))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await run(fetchApiJson('https://api.test/x', { method: 'POST' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, status: 200, data: { recovered: true } });
  });

  it('gives up after one retry rather than hammering a dead upstream', async () => {
    const fetchMock = vi.fn().mockRejectedValue(fetchFailed('ENOTFOUND'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await run(fetchApiJson('https://api.test/x'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: false,
      status: 0,
      data: { message: 'Upstream API unavailable' },
    });
  });

  /**
   * The safety property. ECONNRESET can fire *after* the request was written, so
   * the API may already have processed it. `fetchApiJson` backs signup and
   * refresh, where a replay would create a second account or burn a refresh
   * token twice — so an ambiguous failure must surface, never be retried.
   */
  it('does NOT retry an ambiguous mid-flight socket failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(fetchFailed('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await run(fetchApiJson('https://api.test/signup', { method: 'POST' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(0);
  });

  it('does NOT retry a timeout, and reports it distinctly', async () => {
    const fetchMock = vi.fn().mockRejectedValue(abortError());
    vi.stubGlobal('fetch', fetchMock);

    const result = await run(fetchApiJson('https://api.test/x'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      status: 0,
      data: { message: 'Upstream API timed out' },
    });
  });
});

describe('upstreamStatus', () => {
  it('passes real HTTP statuses through', () => {
    expect(upstreamStatus(401)).toBe(401);
    expect(upstreamStatus(503)).toBe(503);
  });

  it('maps the synthetic 0 to 502 so it never reaches a response', () => {
    expect(upstreamStatus(0)).toBe(502);
    expect(upstreamStatus(999)).toBe(502);
  });
});
