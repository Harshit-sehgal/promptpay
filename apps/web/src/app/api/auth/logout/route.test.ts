import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const BASE = 'http://localhost';
const OLD_ENV = process.env.NEXT_PUBLIC_API_URL;

function makeReq(cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(new URL(`${BASE}/api/auth/logout`), {
    method: 'POST',
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });
}

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failResponse(status: number) {
  return new Response('upstream error', { status });
}

describe('logout route handler (A-049)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4002/api/v1';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.NEXT_PUBLIC_API_URL = OLD_ENV;
  });

  it('clears auth cookies and returns ok on a successful upstream logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ access_token: 'tok', refresh_token: 'rtok' }));

    expect(res.status).toBe(200);
    const calledUrl = (fetchMock.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/auth/logout');
    // Cookies were cleared (Set-Cookie written with empty value / max-age 0).
    expect(res.cookies.getAll().length).toBeGreaterThan(0);
    expect(res.cookies.get('access_token')?.value).toBe('');
    expect(res.cookies.get('refresh_token')?.value).toBe('');
  });

  it('does NOT clear auth cookies and returns an error when the upstream returns 502', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failResponse(502));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ access_token: 'tok', refresh_token: 'rtok' }));

    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toMatch(/server error|retry/i);
    // No Set-Cookie clearing happened — the user must stay logged in.
    expect(res.cookies.getAll().length).toBe(0);
  });

  it('still clears cookies when the upstream reports the token is already dead (401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ access_token: 'tok', refresh_token: 'rtok' }));

    expect(res.status).toBe(200);
    expect(res.cookies.getAll().length).toBeGreaterThan(0);
  });

  it('returns a retryable error when the upstream is unreachable (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ access_token: 'tok', refresh_token: 'rtok' }));

    expect(res.status).toBe(502);
    expect(res.cookies.getAll().length).toBe(0);
  });
});
