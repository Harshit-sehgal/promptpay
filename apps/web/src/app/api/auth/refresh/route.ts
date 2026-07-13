import { NextRequest, NextResponse } from 'next/server';

import {
  apiBaseUrl,
  applyAuthCookies,
  applyRateLimitIdentity,
  clearAuthCookies,
  COOKIE_REFRESH,
  isSecure,
  rateLimitIdentity,
  readAuthCookie,
} from '../_lib/cookies';
import { rejectCrossOriginMutation } from '../_lib/request-guards';

export async function POST(req: NextRequest) {
  try {
    const blockedOrigin = rejectCrossOriginMutation(req);
    if (blockedOrigin) return blockedOrigin;

    // Read the refresh token from the httpOnly cookie.
    const refreshToken = readAuthCookie(req, COOKIE_REFRESH, isSecure(req.headers));
    if (!refreshToken) {
      return NextResponse.json({ message: 'No refresh token' }, { status: 401 });
    }
    const identity = rateLimitIdentity(req);

    const apiRes = await fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity.headers },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      // Refresh failed — clear stale cookies
      return applyRateLimitIdentity(
        clearAuthCookies(
          NextResponse.json(
            { message: (data as { message?: string }).message || 'Refresh failed' },
            { status: apiRes.status },
          ),
          req.headers,
        ),
        identity,
        req.headers,
      );
    }

    const { accessToken, refreshToken: newRefresh } = data as {
      accessToken: string;
      refreshToken: string;
    };

    const response = NextResponse.json(
      { user: (data as Record<string, unknown>).user || null },
      { status: 200 },
    );
    return applyRateLimitIdentity(
      applyAuthCookies(response, {
        accessToken,
        refreshToken: newRefresh,
        headers: req.headers,
      }),
      identity,
      req.headers,
    );
  } catch (err: unknown) {
    console.error(
      'Token Refresh Route Handler error:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
