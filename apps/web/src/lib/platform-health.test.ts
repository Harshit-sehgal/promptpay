import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPlatformHealth, resetPlatformHealthCache } from './platform-health';

/**
 * Five components fetched `/api/platform-health` independently with
 * `cache: 'no-store'`, so nothing deduplicated them — two fired on the homepage
 * for every anonymous visitor. Each crosses the BFF proxy to a 956 MB API host
 * measured at 33% CPU steal, so the duplicates are not free.
 */
describe('getPlatformHealth', () => {
  afterEach(() => {
    resetPlatformHealthCache();
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<Response>) {
    const spy = vi.fn(impl);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  const okResponse = () =>
    Promise.resolve(new Response(JSON.stringify({ status: 'ok', database: 'connected' })));

  it('makes ONE request when several components ask at once', async () => {
    const spy = stubFetch(okResponse);
    const results = await Promise.all([
      getPlatformHealth(),
      getPlatformHealth(),
      getPlatformHealth(),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    for (const r of results)
      expect(r).toEqual({ ok: true, data: { status: 'ok', database: 'connected' } });
  });

  it('reuses the result for a later caller within the window', async () => {
    const spy = stubFetch(okResponse);
    await getPlatformHealth();
    await getPlatformHealth();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps no-store, because a cached answer would report a dead API as healthy', async () => {
    const spy = stubFetch(okResponse);
    await getPlatformHealth();
    expect(spy).toHaveBeenCalledWith('/api/platform-health', { cache: 'no-store' });
  });

  it('distinguishes a bad status from a failed request', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: 503 })));
    expect(await getPlatformHealth()).toEqual({ ok: false, reason: 'http' });

    resetPlatformHealthCache();
    stubFetch(() => Promise.reject(new Error('socket hang up')));
    expect(await getPlatformHealth()).toEqual({ ok: false, reason: 'network' });
  });

  it('treats an unparseable body as network — both mean we hold no health data', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>not json</html>')));
    expect(await getPlatformHealth()).toEqual({ ok: false, reason: 'network' });
  });

  it('does not wedge after a failure — the next caller retries', async () => {
    stubFetch(() => Promise.reject(new Error('down')));
    expect((await getPlatformHealth()).ok).toBe(false);

    resetPlatformHealthCache();
    const spy = stubFetch(okResponse);
    expect((await getPlatformHealth()).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
