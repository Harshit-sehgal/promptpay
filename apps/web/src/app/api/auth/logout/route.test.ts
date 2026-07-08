import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

function makeReq(): NextRequest {
  const req = new NextRequest(new URL('https://app.example/api/auth/logout'), { method: 'POST' });
  req.cookies.set('access_token', 'AT');
  return req;
}

describe('logout route handler (A-049)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears cookies and returns 200 when the API confirms logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('access_token');
  });

  it('does NOT clear cookies on a network error (502)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = await POST(makeReq());
    expect(res.status).toBe(502);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('does NOT clear cookies when the API fails with 5xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
