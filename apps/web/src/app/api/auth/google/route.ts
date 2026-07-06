import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, applyAuthCookies, stripAuthTokens } from '../_lib/cookies';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const googleRes = await fetch(`${apiBaseUrl()}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const googleData = await googleRes.json();
    if (!googleRes.ok) {
      return NextResponse.json(googleData, { status: googleRes.status });
    }

    const { accessToken, refreshToken, user } = googleData as {
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

    const response = NextResponse.json(stripAuthTokens({ ...googleData, user: fullUser }), { status: 200 });
    return applyAuthCookies(response, { accessToken, refreshToken, headers: req.headers });
  } catch (err: unknown) {
    console.error('Google OAuth Route Handler error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}