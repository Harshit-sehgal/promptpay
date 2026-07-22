import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/_lib/cookies', () => ({
  apiBaseUrl: () => 'https://api.waitlayer.test/api/v1',
}));

import { GET } from './route';

describe('GET /api/platform-health', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies the API health contract without caching it', async () => {
    const upstreamPayload = {
      status: 'ok',
      timestamp: '2026-07-22T10:00:00.000Z',
      uptimeSeconds: 120,
      database: 'connected',
      redis: { status: 'connected', latencyMs: 4 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamPayload), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.waitlayer.test/api/v1/health',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.json()).resolves.toEqual(upstreamPayload);
  });

  it('returns a safe unavailable state when the upstream health check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unavailable',
      message: 'Backend health check unavailable',
    });
  });
});
