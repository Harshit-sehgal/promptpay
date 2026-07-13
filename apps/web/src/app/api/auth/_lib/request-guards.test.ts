import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { apiBaseUrl } from './cookies';
import {
  readLimitedJsonBody,
  readLimitedTextBody,
  rejectCrossOriginMutation,
} from './request-guards';

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
});

function request(
  method: string,
  options: { body?: string; headers?: HeadersInit; url?: string } = {},
): NextRequest {
  return new NextRequest(options.url ?? 'https://app.example/api/auth/login', {
    method,
    headers: options.headers,
    body: options.body,
  });
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

describe('request route guards', () => {
  it('rejects cross-origin mutating requests by Origin', async () => {
    const response = rejectCrossOriginMutation(
      request('POST', {
        headers: { origin: 'https://evil.example' },
      }),
    );

    expect(response?.status).toBe(403);
    await expect(responseCode(response as Response)).resolves.toBe('CROSS_ORIGIN_MUTATION');
  });

  it('rejects cross-origin mutating requests by Referer when Origin is absent', async () => {
    const response = rejectCrossOriginMutation(
      request('POST', {
        headers: { referer: 'https://evil.example/form' },
      }),
    );

    expect(response?.status).toBe(403);
  });

  it('allows same-origin mutating requests', () => {
    const response = rejectCrossOriginMutation(
      request('POST', {
        headers: { origin: 'https://app.example' },
      }),
    );

    expect(response).toBeNull();
  });

  it('fails closed without Origin/Referer unless Fetch Metadata proves same-origin', () => {
    expect(rejectCrossOriginMutation(request('POST'))?.status).toBe(403);
    expect(
      rejectCrossOriginMutation(
        request('POST', { headers: { 'sec-fetch-site': 'same-origin' } }),
      ),
    ).toBeNull();
  });

  it('does not apply origin checks to safe methods', () => {
    const response = rejectCrossOriginMutation(
      request('GET', {
        headers: { origin: 'https://evil.example' },
      }),
    );

    expect(response).toBeNull();
  });

  it('parses JSON bodies within the byte limit', async () => {
    const result = await readLimitedJsonBody(
      request('POST', {
        body: JSON.stringify({ email: 'dev@example.com' }),
      }),
      100,
    );

    expect(result).toEqual({ ok: true, body: { email: 'dev@example.com' } });
  });

  it('rejects invalid JSON bodies', async () => {
    const result = await readLimitedJsonBody(request('POST', { body: '{not json' }), 100);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    await expect(responseCode(result.response)).resolves.toBe('INVALID_JSON_BODY');
  });

  it('rejects oversized Content-Length before reading the stream', async () => {
    const result = await readLimitedTextBody(
      request('POST', {
        body: '{}',
        headers: { 'content-length': '101' },
      }),
      100,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(result.response.headers.get('X-Max-Body-Bytes')).toBe('100');
  });

  it('rejects streamed bodies once the byte limit is crossed', async () => {
    const result = await readLimitedTextBody(
      request('POST', {
        body: JSON.stringify({ value: 'x'.repeat(50) }),
      }),
      20,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    await expect(responseCode(result.response)).resolves.toBe('BODY_TOO_LARGE');
  });

  it('allows HTTPS and loopback HTTP upstream API base URLs', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/api/v1/';
    expect(apiBaseUrl()).toBe('https://api.example.com/api/v1');

    process.env.NEXT_PUBLIC_API_URL = 'http://[::1]:4002/api/v1';
    expect(apiBaseUrl()).toBe('http://[::1]:4002/api/v1');
  });

  it('rejects cleartext remote upstream API base URLs', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.example.com/api/v1';

    expect(() => apiBaseUrl()).toThrow(/refuses to send credentials/);
  });

  it('rejects non-HTTP upstream API base URL protocols', () => {
    process.env.NEXT_PUBLIC_API_URL = 'ftp://localhost/api/v1';

    expect(() => apiBaseUrl()).toThrow(/refuses to send credentials/);
  });
});
