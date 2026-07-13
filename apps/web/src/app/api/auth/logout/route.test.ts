import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const BASE = 'https://app.example';

function makeReq(init: { cookie?: string } = {}): NextRequest {
  return new NextRequest(new URL(BASE + '/api/auth/logout'), {
    method: 'POST',
    headers: { origin: BASE, ...(init.cookie ? { cookie: init.cookie } : {}) },
  });
}

function jsonResponse(status = 200) {
  return new Response(JSON.stringify({ ok: status < 300 }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// A-049: logout must wait for the server revocation before clearing cookies.
// A failed logout (network error or 5xx) must leave the session visibly alive
// (cookies uncleared) so the user can retry, instead of a false "logged out".
describe('logout route (A-049)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears auth cookies on a successful 200 revocation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ cookie: 'access_token=valid' }));

    expect(res.status).toBe(200);
    const cleared = res.cookies
      .getAll()
      .filter((c) => c.name.includes('access_token') || c.name.includes('refresh_token'));
    expect(cleared.length).toBeGreaterThan(0);
    // Every cleared auth cookie is forced to an empty value with maxAge 0.
    // (The BFF also sets a non-auth __Host-wl_client_id identity cookie for
    // rate limiting — that one must survive logout.)
    for (const c of cleared) {
      expect(c.value).toBe('');
      expect(c.maxAge).toBe(0);
    }
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('clears auth cookies when the API reports the token is already dead (401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ cookie: 'access_token=expired' }));

    expect(res.status).toBe(200);
    expect(res.cookies.getAll().length).toBeGreaterThan(0);
  });

  it('does NOT clear cookies on a network error (502) so the session stays alive', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ cookie: 'access_token=valid' }));

    expect(res.status).toBe(502);
    expect(res.cookies.getAll().length).toBe(0);
  });

  it('does NOT clear cookies on a server 5xx (retryable failure)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ cookie: 'access_token=valid' }));

    expect(res.status).toBe(503);
    expect(res.cookies.getAll().length).toBe(0);
  });
});
