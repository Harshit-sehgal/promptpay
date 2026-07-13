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

    const signupRes = await fetch(`${apiBaseUrl()}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity.headers },
      body: JSON.stringify(body),
    });
    const signupData = await signupRes.json();
    if (!signupRes.ok) {
      return applyRateLimitIdentity(
        NextResponse.json(signupData, { status: signupRes.status }),
        identity,
        req.headers,
      );
    }

    const { accessToken, refreshToken, user } = signupData as {
      accessToken: string;
      refreshToken: string;
      user: unknown;
    };

    // Fetch full user profile server-side
    const meRes = await fetch(`${apiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let fullUser = user;
    if (meRes.ok) {
      const meData = await meRes.json();
      fullUser = { ...(user as Record<string, unknown>), ...(meData as Record<string, unknown>) };
    }

    const response = NextResponse.json(stripAuthTokens({ ...signupData, user: fullUser }), { status: 201 });
    return applyRateLimitIdentity(
      applyAuthCookies(response, { accessToken, refreshToken, headers: req.headers }),
      identity,
      req.headers,
    );
  } catch (err: unknown) {
    console.error('Signup Route Handler error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
