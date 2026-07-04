import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_ACCESS, COOKIE_REFRESH } from '../auth/_lib/cookies';

/**
 * Catch-all proxy: forwards every API request from the browser to the
 * upstream NestJS API server, forwarding the httpOnly access_token cookie
 * as an Authorization header (the API still supports Bearer too — dual
 * extraction in jwt.strategy.ts). The browser sends `withCredentials: true`
 * to same-origin homelid URLs, so the httpOnly cookies arrive here
 * automatically and are forwarded server-to-server.
 *
 * This avoids cross-origin cookie transport (SameSite=Lax) and lets the
 * web app talk to the API through Next.js Route Handlers — the standard
 * pattern for httpOnly-cookie-based SPA auth.
 */

// Default API base URL — `localhost:4000` matches the API's `API_PORT`
// default (4000) in packages/config. The earlier `localhost:4002` default
// drifted from the actual API port and only worked when env override set it.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function upstreamUrl(pathname: string): string {
  // `pathname` starts with `/api/...` — strip the `/api` prefix so the
  // upstream gets `/api/v1/...` which is what the API controller paths use
  // (global prefix `api/v1` then the controller path).
  return `${API_BASE}${pathname}`;
}

export async function GET(req: NextRequest) {
  return proxy(req);
}

export async function POST(req: NextRequest) {
  return proxy(req);
}

export async function PATCH(req: NextRequest) {
  return proxy(req);
}

export async function DELETE(req: NextRequest) {
  return proxy(req);
}

async function proxy(req: NextRequest): Promise<NextResponse> {
  try {
    const url = upstreamUrl(req.nextUrl.pathname);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Forward the access token from the httpOnly cookie as a Bearer header
    const accessToken = req.cookies.get(COOKIE_ACCESS)?.value;
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Pick up the refresh token for auth/refresh calls below
    const refreshToken = req.cookies.get(COOKIE_REFRESH)?.value;

    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      try {
        body = await req.text();

        // Intercept /auth/refresh: the browser can't read the httpOnly
        // refresh_token cookie, so it sends an empty body. The proxy
        // reads the cookie and injects it into the API-compatible body.
        if (url.endsWith('/auth/refresh') && refreshToken) {
          // The API expects { refreshToken }
          body = JSON.stringify({ refreshToken });
        }
      } catch {
        body = undefined;
      }
    }

    const upstreamRes = await fetch(url, {
      method: req.method,
      headers,
      body,
    });

    const contentType = upstreamRes.headers.get('content-type') || '';
    let responseBody: unknown;
    const responseStatus = upstreamRes.status;

    if (contentType.includes('application/json')) {
      responseBody = await upstreamRes.json();
    } else {
      responseBody = await upstreamRes.text();
    }

    return NextResponse.json(responseBody, { status: responseStatus });
  } catch {
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}