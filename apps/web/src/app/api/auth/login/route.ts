import { NextRequest, NextResponse } from 'next/server';

import {
  apiBaseUrl,
  applyAuthCookies,
  applyRateLimitIdentity,
  rateLimitIdentity,
  stripAuthTokens,
} from '../_lib/cookies';
import { readLimitedJsonBody, rejectCrossOriginMutation } from '../_lib/request-guards';

export async function POST(req: NextRequest) {
  try {
    const blockedOrigin = rejectCrossOriginMutation(req);
    if (blockedOrigin) return blockedOrigin;
    const bodyResult = await readLimitedJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.body;
    const identity = rateLimitIdentity(req);

    // 1. Call the API login endpoint
    const loginRes = await fetch(`${apiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity.headers },
      body: JSON.stringify(body),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      return applyRateLimitIdentity(
        NextResponse.json(loginData, { status: loginRes.status }),
        identity,
        req.headers,
      );
    }

    const { accessToken, refreshToken, user } = loginData as {
      accessToken: string;
      refreshToken: string;
      user: unknown;
    };

    // 2. Fetch the full user profile from /auth/me so the browser gets
    //    trustLevel/status/referralCode without a second client-side round-trip.
    const meRes = await fetch(`${apiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let fullUser = user;
    if (meRes.ok) {
      const meData = await meRes.json();
      fullUser = { ...(user as Record<string, unknown>), ...(meData as Record<string, unknown>) };
    }

    // 3. Set httpOnly cookies + return user (NOT tokens) to browser
    const response = NextResponse.json(stripAuthTokens({ ...loginData, user: fullUser }), { status: 200 });
    return applyRateLimitIdentity(
      applyAuthCookies(response, { accessToken, refreshToken, headers: req.headers }),
      identity,
      req.headers,
    );
  } catch (err: unknown) {
    console.error('Login Route Handler error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
