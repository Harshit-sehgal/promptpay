import { NextRequest, NextResponse } from 'next/server';

import {
  apiBaseUrl,
  applyRateLimitIdentity,
  clearAuthCookies,
  COOKIE_ACCESS,
  isSecure,
  rateLimitIdentity,
  readAuthCookie,
} from '../_lib/cookies';
import { rejectCrossOriginMutation } from '../_lib/request-guards';

export async function POST(req: NextRequest) {
  try {
    const blockedOrigin = rejectCrossOriginMutation(req);
    if (blockedOrigin) return blockedOrigin;

    // Forward the access token to the API's /auth/logout so it can revoke
    // the server-side session row. The API's `JwtStrategy` checks the session
    // row's `revoked` flag on every request — it is the sole server-side kill
    // switch (there is no JWT blacklist). If this call fails silently and we
    // clear cookies anyway, an already-exfiltrated access JWT remains valid
    // for up to 15 minutes (the access token TTL) despite the user's logout.
    //
    // We treat a 401 response as confirmation that the token is already dead
    // (expired or previously revoked) — the session is unusable, so clearing
    // cookies is correct. Network errors and 5xx responses propagate as
    // non-200 so the client surfaces a retryable failure rather than a false
    // sense of security.
    const accessToken = readAuthCookie(req, COOKIE_ACCESS, isSecure(req.headers));
    const identity = rateLimitIdentity(req);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...identity.headers,
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    let apiRes: Response;
    try {
      apiRes = await fetch(`${apiBaseUrl()}/auth/logout`, {
        method: 'POST',
        headers,
      });
    } catch {
      // Network error — don't clear cookies; the revocation didn't happen.
      return NextResponse.json(
        { message: 'Logout failed — could not reach server. Retry.' },
        { status: 502 },
      );
    }

    if (!apiRes.ok && apiRes.status !== 401) {
      // The API failed to process the request (5xx, 400, etc.) but it's not
      // a definitive "token is dead" signal. Don't clear cookies — the user
      // should retry.
      return NextResponse.json(
        { message: 'Logout failed — server error. Retry.' },
        { status: apiRes.status },
      );
    }

    // The API confirmed revocation (2xx) OR the token was already dead (401).
    // In either case the session row is either now revoked or already was —
    // clearing cookies is safe.
    return applyRateLimitIdentity(
      clearAuthCookies(NextResponse.json({ ok: true }, { status: 200 }), req.headers),
      identity,
      req.headers,
    );
  } catch (err: unknown) {
    console.error('Logout Route Handler error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
