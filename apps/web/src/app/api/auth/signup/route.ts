import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, applyAuthCookies, stripAuthTokens, getRequestHost } from '../_lib/cookies';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const host = getRequestHost(req.headers);

    const signupRes = await fetch(`${apiBaseUrl()}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const signupData = await signupRes.json();
    if (!signupRes.ok) {
      return NextResponse.json(signupData, { status: signupRes.status });
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
    return applyAuthCookies(response, { accessToken, refreshToken, requestHost: host });
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}