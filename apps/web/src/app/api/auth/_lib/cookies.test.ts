import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { applyAuthCookies, clearAuthCookies, COOKIE_ACCESS, readAuthCookie } from './cookies';

function fakeReq(cookies: Record<string, string>) {
  return {
    cookies: {
      get(name: string) {
        return cookies[name] ? { value: cookies[name] } : undefined;
      },
    },
  };
}

describe('auth cookie names (A-002)', () => {
  it('writes __Host- prefixed cookies over HTTPS and bare cookies over HTTP', () => {
    const secure = new Headers();
    secure.set('x-forwarded-proto', 'https');
    const resSecure = applyAuthCookies(NextResponse.json({}), {
      accessToken: 'AT',
      refreshToken: 'RT',
      headers: secure,
    });
    expect(resSecure.cookies.get('__Host-access_token')?.value).toBe('AT');
    expect(resSecure.cookies.get('__Host-refresh_token')?.value).toBe('RT');
    // No double-prefix, no bare name under HTTPS.
    expect(resSecure.cookies.get('__Host-__Host-access_token')).toBeUndefined();
    expect(resSecure.cookies.get('access_token')).toBeUndefined();

    const insecure = new Headers();
    const resInsecure = applyAuthCookies(NextResponse.json({}), {
      accessToken: 'AT',
      refreshToken: 'RT',
      headers: insecure,
    });
    expect(resInsecure.cookies.get('access_token')?.value).toBe('AT');
    expect(resInsecure.cookies.get('refresh_token')?.value).toBe('RT');
    expect(resInsecure.cookies.get('__Host-access_token')).toBeUndefined();
  });

  it('reads bare and __Host- prefixed names (and legacy double-prefix)', () => {
    expect(readAuthCookie(fakeReq({ 'access_token': 'bare' }), COOKIE_ACCESS)).toBe('bare');
    expect(readAuthCookie(fakeReq({ '__Host-access_token': 'pref' }), COOKIE_ACCESS)).toBe('pref');
    expect(readAuthCookie(fakeReq({ '__Host-__Host-access_token': 'legacy' }), COOKIE_ACCESS)).toBe('legacy');
  });

  it('clears the current plus legacy double-prefixed and __Host- names on logout', () => {
    const insecure = new Headers();
    const res = clearAuthCookies(NextResponse.json({}), insecure);
    const names = res.cookies.getAll().map((c) => c.name);
    expect(names).toContain('access_token');
    expect(names).toContain('refresh_token');
    expect(names).toContain('__Host-__Host-access_token');
    expect(names).toContain('__Host-access_token');
    expect(names).toContain('__Host-__Host-refresh_token');
  });
});
