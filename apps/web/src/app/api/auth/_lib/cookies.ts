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
 * so we must trust X-Forwarded-Proto to mark cookies Secure. In dev (http://
 * localhost) we keep them non-Secure so the browser actually accepts them
 * for the dev host.
 */
function isSecure(requestHost: string | null): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  // Honour the explicit override for staging over TLS even in non-prod.
  if (process.env.COOKIE_SECURE === 'true') return true;
  // Default: localhost dev hosts are not TLS.
  if (!requestHost) return false;
  return !/(^|\.)localhost(:\d+)?$/.test(requestHost) && !requestHost.startsWith('127.');
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
 * `requestHost` is the `Host` header from the original request — used
 * to decide whether to set the Secure attribute.
 */
export function applyAuthCookies(
  response: NextResponse,
  args: { accessToken: string; refreshToken: string; requestHost: string | null },
): NextResponse {
  const secure = isSecure(args.requestHost);
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
export function clearAuthCookies(response: NextResponse, requestHost: string | null): NextResponse {
  const secure = isSecure(requestHost);
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

/**
 * Extract the request host from a NextRequest headers bag. Used for the
 * Secure-attribute decision above.
 */
export function getRequestHost(headers: Headers): string | null {
  return headers.get('host');
}
