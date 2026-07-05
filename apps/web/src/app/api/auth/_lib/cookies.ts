import { NextResponse } from 'next/server';

/**
 * Cookie names for the httpOnly auth flow.
 *
 * WHY httpOnly:
 *   The previous design stored both access (15m) and refresh (30d) tokens in
 *   `localStorage`. Any XSS could `localStorage.getItem('refreshToken')` and
 *   exfiltrate a long-lived session for 30 days. By moving both tokens into
 *   HttpOnly cookies set by the server-side Route Handlers, the browser
 *   JavaScript runtime cannot read them at all — even a successful XSS
 *   yields only the ability to make same-origin requests, which it could do
 *   anyway via `fetch`. The auth flow that's actually exploitable by XSS
 *   shrinks to "the XSS can act as the logged-in user" — which is the same
 *   threat surface as a CSRF, not a 30-day secret theft.
 *
 * Cookie name `access_token` — verified by `middleware.ts` to gate protected
 * routes (replaces the legacy non-httpOnly `session` cookie).
 */
export const COOKIE_ACCESS = 'access_token';
export const COOKIE_REFRESH = 'refresh_token';

/**
 * JWT access token TTL — must match JWT_ACCESS_TTL on the API (15m default).
 * Used for the access_token cookie's Max-Age. The middleware tolerates the
 * token being expired at route guard time because 30d refresh is the
 * authoritative session lifetime.
 */
const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1h upper bound — actual token expires in 15m, but cookie can outlive

/**
 * Refresh cookie Max-Age — 30 days, matching JWT_REFRESH_TTL on the API.
 * This is the upper bound of an unstolen session.
 */
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Are we running over HTTPS? In production the Next.js proxy terminates TLS,
 * so we trust X-Forwarded-Proto to mark cookies Secure. In dev (http://
 * localhost) we keep them non-Secure so the browser actually accepts them
 * for the dev host.
 *
 * Decision order:
 *   1. COOKIE_SECURE='true'/'false' → honour explicit override FIRST (even in
 *      production). Operator escape hatch for staging-over-HTTP deploys.
 *   2. NODE_ENV=production → always Secure (canonical deploy path).
 *   3. X-Forwarded-Proto header (if present) → Secure if it contains 'https'.
 *      This is the correct signal when a reverse proxy/LB terminates TLS
 *      and the Node process itself sees only HTTP. Reading the actual Host
 *      header is unreliable because HTTP staging backends with non-localhost
 *      hostnames (e.g. `staging.example.com`) would otherwise be flagged
 *      as HTTPS and have the browser silently drop Secure cookies.
 *   4. Localhost / 127.* hosts → NOT Secure (browser will reject on plain
 *      HTTP localhost even when Secure is set).
 *   5. Fallback: assume non-HTTPS (Safe default — DOESN'T expose auth cookies
 *      to the wrong protocol; if the deploy is HTTPS the proxy will set
 *      X-Forwarded-Proto upstream).
 */
function isSecure(headers: Headers): boolean {
  // Decision order — explicit env override wins over the NODE_ENV default:
  //   1. `COOKIE_SECURE=true|false` — honour the explicit operator override
  //      first, including in production. A staging host running with
  //      `NODE_ENV=production` over plain HTTP (a common choice for code-path
  //      parity) has no other way to disable `Secure` cookies, and without
  //      this escape hatch the browser silently drops them and login fails
  //      with no signal. The override must come first to be a real kill switch.
  //   2. `NODE_ENV=production` → assume HTTPS by default (the canonical deploy
  //      path). If a production deploy runs over HTTP without setting
  //      X-Forwarded-Proto, the cookie is marked Secure and the browser drops
  //      it — a visible login failure that's debuggable, vs. an insecure
  //      cookie slipping through. Operators can set `COOKIE_SECURE=false` to
  //      recover (case 1).
  //   3. X-Forwarded-Proto header (if present) → Secure if it contains 'https'.
  //      This is the correct signal when a reverse proxy/LB terminates TLS
  //      and the Node process itself sees only HTTP. Reading the actual Host
  //      header is unreliable because HTTP staging backends with non-localhost
  //      hostnames (e.g. `staging.example.com`) would otherwise be flagged
  //      as HTTPS and have the browser silently drop Secure cookies.
  //   4. Localhost / 127.* hosts → NOT Secure (browser will reject Secure on
  //      plain HTTP localhost even when Secure is set).
  //   5. Fallback: assume non-HTTPS (Safe default — DOESN'T expose auth cookies
  //      to the wrong protocol; if the deploy is HTTPS the proxy will set
  //      X-Forwarded-Proto upstream).
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  if (process.env.NODE_ENV === 'production') return true;
  // Trust X-Forwarded-Proto above all else — a TLS-terminating proxy sets
  // this. Without this check, the prior Host-based heuristic would mark
  // HTTP staging backends as Secure-suitable and break login silently.
  const xfp = headers.get('x-forwarded-proto');
  if (xfp) return xfp.toLowerCase().split(',')[0].trim() === 'https';
  const host = headers.get('host') || '';
  if (!host) return false;
  // Localhost / 127.* are never Secure (browser denies Secure on plain
  // HTTP localhost).
  return !/(^|\.)localhost(:\d+)?$/.test(host) && !host.startsWith('127.');
}

/**
 * Strip `accessToken` and `refreshToken` fields from a JSON object, returning
 * a copy safe to send to the browser. Used by login/refresh Route Handlers
 * so the tokens never leak to client JavaScript (where they could be
 * exfiltrated by an XSS).
 */
export function stripAuthTokens<T extends Record<string, unknown>>(body: T): Omit<T, 'accessToken' | 'refreshToken'> {
  const { accessToken: _a, refreshToken: _r, ...rest } = body as Record<string, unknown>;
  return rest as Omit<T, 'accessToken' | 'refreshToken'>;
}

/**
 * Apply the auth cookies to a NextResponse. Used by every Route Handler
 * that created or rotated tokens (login / signup / google / refresh).
 *
 * Pass the request headers so isSecure can read X-Forwarded-Proto when a
 * reverse proxy terminates TLS.
 */
export function applyAuthCookies(
  response: NextResponse,
  args: { accessToken: string; refreshToken: string; headers: Headers },
): NextResponse {
  const secure = isSecure(args.headers);
  response.cookies.set(COOKIE_ACCESS, args.accessToken, {
    httpOnly: true,
    secure: secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  response.cookies.set(COOKIE_REFRESH, args.refreshToken, {
    httpOnly: true,
    secure: secure,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

/**
 * Clear the auth cookies on a Response. Used by logout and on refresh failure
 * so a stale cookie can't impersonate the user after a server-side revocation.
 */
export function clearAuthCookies(response: NextResponse, headers: Headers): NextResponse {
  const secure = isSecure(headers);
  response.cookies.set(COOKIE_ACCESS, '', {
    httpOnly: true,
    secure: secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(COOKIE_REFRESH, '', {
    httpOnly: true,
    secure: secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

/**
 * Get the upstream API base URL from env. `NEXT_PUBLIC_API_URL` is exposed
 * to both client and server (Next.js convention), so the same value the
 * client uses is reachable from Route Handlers.
 */
export function apiBaseUrl(): string {
  // Default `localhost:4000` matches the API's API_PORT default (4000). The
  // earlier `localhost:4002` default drifted from the actual API port.
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
}
