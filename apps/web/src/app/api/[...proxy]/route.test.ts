import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const BASE = 'https://app.example';

function makeReq(path: string, init: RequestInit = {}): NextRequest {
  const method = init.method ?? (init.body ? 'POST' : 'GET');
  return new NextRequest(new URL(BASE + path), { method, ...init });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('proxy allowlist + response scrubbing (A-004, A-005, A-027)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards /developer/delete-account (A-004)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq('/api/developer/delete-account', { body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }) }));

    expect(res.status).toBe(200);
    const calledUrl = (fetchMock.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/developer/delete-account');
  });

  it('forwards /admin/devices/:id/recovery-token (A-027)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ token: 'abc' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq('/api/admin/devices/device-uuid/recovery-token', { body: JSON.stringify({ userId: 'u', reason: 'lost' }) }));

    expect(res.status).toBe(200);
    const calledUrl = (fetchMock.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/admin/devices/device-uuid/recovery-token');
  });

  it('rejects paths outside the allowlist with 403', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq('/api/auth/signup', { body: JSON.stringify({ email: 'x' }) }));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the TOTP setup secret for /auth/2fa/setup (A-005)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ secret: 'TOTPSECRET', otpauthUrl: 'otp://x' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq('/api/auth/2fa/setup'));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.secret).toBe('TOTPSECRET');
    expect(body.otpauthUrl).toBe('otp://x');
  });

  it('strips unrelated secret fields from other routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ secret: 'LEAK', name: 'dev', eventSecret: 'evt' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(makeReq('/api/developer/settings'));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.secret).toBeUndefined();
    expect(body.eventSecret).toBeUndefined();
    expect(body.name).toBe('dev');
  });
});
