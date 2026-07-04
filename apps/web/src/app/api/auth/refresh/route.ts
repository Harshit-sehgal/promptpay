import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, applyAuthCookies, clearAuthCookies, COOKIE_REFRESH, getRequestHost } from '../_lib/cookies';

export async function POST(req: NextRequest) {
  try {
    const host = getRequestHost(req.headers);

    // Read the refresh token from the httpOnly cookie.
    const refreshToken = req.cookies.get(COOKIE_REFRESH)?.value;
    if (!refreshToken) {
      return NextResponse.json({ message: 'No refresh token' }, { status: 401 });
    }

    const apiRes = await fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      // Refresh failed — clear stale cookies
      return clearAuthCookies(NextResponse.json({ message: (data as { message?: string }).message || 'Refresh failed' }, { status: apiRes.status }), host);
    }

    const { accessToken, refreshToken: newRefresh } = data as {
      accessToken: string;
      refreshToken: string;
    };

    const response = NextResponse.json({ user: (data as Record<string, unknown>).user || null }, { status: 200 });
    return applyAuthCookies(response, { accessToken, refreshToken: newRefresh, requestHost: host });
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}