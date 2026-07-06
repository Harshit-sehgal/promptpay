import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, applyAuthCookies, stripAuthTokens } from '../_lib/cookies';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Call the API login endpoint
    const loginRes = await fetch(`${apiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      return NextResponse.json(loginData, { status: loginRes.status });
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
    return applyAuthCookies(response, { accessToken, refreshToken, headers: req.headers });
  } catch (err: unknown) {
    console.error('Login Route Handler error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}