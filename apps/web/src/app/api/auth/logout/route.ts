import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, clearAuthCookies, COOKIE_ACCESS, getRequestHost } from '../_lib/cookies';

export async function POST(req: NextRequest) {
  try {
    const host = getRequestHost(req.headers);

    // Forward the access token to the API's /auth/logout so it can revoke
    // the server-side session row.
    const accessToken = req.cookies.get(COOKIE_ACCESS)?.value;
    await fetch(`${apiBaseUrl()}/auth/logout`, {
      method: 'POST',
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json' },
    }).catch(() => {
      // Best-effort — the server might already be down; just clear cookies.
    });

    return clearAuthCookies(NextResponse.json({ ok: true }, { status: 200 }), host);
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}