import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { errors, jwtVerify } from 'jose';

const PROTECTED_PREFIXES = ['/developer', '/advertiser', '/admin', '/settings', '/dashboard'];

// Static pages that can be publicly cached
const STATIC_CACHEABLE_PATHS = ['/privacy', '/terms', '/payout-policy', '/advertiser-policy'];

/**
 * Next.js middleware that gates protected routes on the httpOnly
 * `access_token` cookie.
 *
 * History:
 *   (1) Originally the route gate checked a static `session=1` cookie — a
 *       trivial bypass (`document.cookie = 'session=1'`).
 *   (2) Then the auth-context wrote the real JWT access token into a
 *       non-httpOnly `session` cookie, verified here via jose. That closed
 *       the bypass but the 30-day *refresh* token still lived in
 *       `localStorage`, exposed to any XSS exfiltration.
 *   (3) Now (this version) tokens live in httpOnly cookies (`access_token` +
 *       `refresh_token`) set by the Next.js Route Handlers — not reachable
 *       by JavaScript at all. Middleware verifies the httpOnly `access_token`
 *       cookie the same way.
 *
 * Edge-runtime compatible: `jose` is zero-dependency and works in Next.js
 * Edge Middleware without polyfills.
 *
 * Middleware tolerates an expired access token: the JWT_REFRESH_TTL is 30d
 * while the access token is 15m, so a slightly-stale cookie should not send
 * a logged-in user back to /login on every page load. On expiry, the
 * client-side 401 interceptor refreshes the cookie via the same-origin
 * `/api/auth/refresh` Route Handler before any visible redirect happens.
 * We verify with `clockTolerance` to avoid edge-case clock-skew false rejects.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) {
    // Set long-lived cache headers for static policy pages
    if (STATIC_CACHEABLE_PATHS.some((p) => pathname === p)) {
      const res = NextResponse.next();
      res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      return res;
    }
    return NextResponse.next();
  }

  const accessCookie = request.cookies.get('access_token');
  const refreshCookie = request.cookies.get('refresh_token');
  const token = accessCookie?.value;

  if (!token) {
    if (refreshCookie?.value) {
      return NextResponse.next();
    }
    return redirectToLogin(pathname, request);
  }

  try {
    // Verify the JWT access token with the same secret the NestJS API uses
    // (configured via the shared JWT_SECRET env var). Tolerate a small
    // clock skew so brief token-expiry boundary doesn't bounce users.
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret, { clockTolerance: '30s' });
    return NextResponse.next();
  } catch (err) {
    if (err instanceof errors.JWTExpired && refreshCookie?.value) {
      return NextResponse.next();
    }
    return redirectToLogin(pathname, request);
  }
}

function redirectToLogin(pathname: string, request: NextRequest): NextResponse {
  const loginUrl = new URL('/auth/login', request.url);
  loginUrl.searchParams.set('returnUrl', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match only protected prefix paths so middleware (including jose JWT
     * verification) is loaded in Edge runtime only for auth-gated pages, not
     * for every public page (homepage, login, signup, etc.). Public pages
     * pass through without the Edge runtime cost.
     *
     * Matches: /developer, /developer/*, /advertiser, /advertiser/*, /admin,
     *          /admin/*, /settings, /settings/*, /dashboard, /dashboard/*
     */
    '/developer/:path*',
    '/advertiser/:path*',
    '/admin/:path*',
    '/settings/:path*',
    '/dashboard/:path*',
    // Public static pages — middleware handles caching headers
    '/privacy',
    '/terms',
    '/payout-policy',
    '/advertiser-policy',
  ],
};
