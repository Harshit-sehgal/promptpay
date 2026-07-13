import { errors, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { validateWebEnv } from '@/lib/web-env';

const PROTECTED_PREFIXES = ['/developer', '/advertiser', '/admin'];

// Static/marketing pages that can be publicly cached at the edge
const STATIC_CACHEABLE_PATHS = [
  '/',
  '/pricing',
  '/comparison',
  '/faq',
  '/security',
  '/privacy',
  '/terms',
  '/payout-policy',
  '/advertiser-policy',
];

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

/**
 * Resolve the JWT signing secret for Edge middleware.
 *
 * Unlike the NestJS API (Node runtime, reads env at process start), Next.js
 * Edge middleware inlines `process.env` values at *build* time. A secret that
 * is only injected at container/serverless *runtime* therefore appears as
 * `undefined` here. We require a non-trivial secret and return `null` when it
 * is missing/unsafe so callers fail closed (redirect to login) instead of
 * verifying tokens against a bogus `"undefined"` key.
 */
function getJwtSecret(): Uint8Array | null {
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[waitlayer] JWT_SECRET is missing or too short in the web middleware. ' +
          'It must be present at build time (Edge runtime inlines env vars). ' +
          'All protected routes will fail closed.',
      );
    }
    return null;
  }
  return new TextEncoder().encode(raw);
}

export async function middleware(request: NextRequest) {
  // Fail fast in production if the web env (in particular JWT_SECRET, which
  // must match the API's) is missing/unsafe. In dev/test this is a no-op
  // (A-016). Throwing here surfaces the misconfiguration instead of silently
  // bouncing every logged-in user to /login.
  validateWebEnv();

  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) {
    // Set long-lived cache headers for static policy pages
    if (STATIC_CACHEABLE_PATHS.some((p) => pathname === p)) {
      const res = NextResponse.next();
      res.headers.set(
        'Cache-Control',
        'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      );
      return res;
    }
    return NextResponse.next();
  }

  const secure =
    request.nextUrl.protocol === 'https:' ||
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
  const accessCookie =
    request.cookies.get('__Host-access_token') ??
    (!secure ? request.cookies.get('access_token') : undefined);
  const refreshCookie =
    request.cookies.get('__Host-refresh_token') ??
    (!secure ? request.cookies.get('refresh_token') : undefined);
  const token = accessCookie?.value;

  // The edge gate must not trust the mere *presence* of a refresh cookie value
  // (a forged `refresh_token=anything` cookie would otherwise bypass the
  // redirect). A valid refresh cookie is one signed by our own JWT_SECRET —
  // even if expired, the client-side interceptor will silently refresh it.
  // Anything else (bad signature, malformed) is treated as absent.
  const hasValidRefresh = async (): Promise<boolean> => {
    if (!refreshCookie?.value) return false;
    // Edge middleware inlines `process.env.JWT_SECRET` at *build* time. If the
    // secret is only injected at container/serverless runtime, this is
    // `undefined` and verification is impossible — fail closed rather than
    // verifying against a bogus key.
    const secret = getJwtSecret();
    if (!secret) return false;
    try {
      await jwtVerify(refreshCookie.value, secret, { clockTolerance: '30s' });
      return true;
    } catch (e) {
      // Signature is valid but the token is expired → still a legitimate
      // (ours) token the client can refresh. Any other error means the
      // cookie is forged/garbage and must not grant passage.
      return e instanceof errors.JWTExpired;
    }
  };

  if (!token) {
    if (await hasValidRefresh()) {
      return NextResponse.next();
    }
    return redirectToLogin(pathname, request);
  }

  try {
    // Verify the JWT access token with the same secret the NestJS API uses
    // (configured via the shared JWT_SECRET env var, inlined at build time for
    // the Edge runtime). Tolerate a small clock skew so a brief token-expiry
    // boundary doesn't bounce users. If the secret is unavailable, fail closed.
    const secret = getJwtSecret();
    if (!secret) {
      return redirectToLogin(pathname, request);
    }
    await jwtVerify(token, secret, { clockTolerance: '30s' });
    return NextResponse.next();
  } catch (err) {
    if (err instanceof errors.JWTExpired && (await hasValidRefresh())) {
      return NextResponse.next();
    }
    return redirectToLogin(pathname, request);
  }
}

function redirectToLogin(_pathname: string, request: NextRequest): NextResponse {
  // NOTE: previously this appended `?returnUrl=<pathname>` to the login URL.
  // That param was never read by /auth/login (no consumer existed) AND posed
  // a latent open-redirect: if a future login page naively read+redirected
  // to it, an attacker could replay a crafted `returnUrl` against a victim's
  // still-valid cookie to bounce them off-site after a legitimate login.
  // Post-login, the browser naturally lands on the dashboard the auth-context
  // chooses — no server-side return target is needed. Dropped to remove both
  // the dead param and the redirect-oracle surface. The `pathname` argument is
  // retained in the signature (prefixed `_`) for future audit routing — e.g.
  // logging the original protected route on a redirect — without re-introducing
  // a client-controllable redirect target.
  const loginUrl = new URL('/auth/login', request.url);
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
     *          /admin/*
     */
    '/developer/:path*',
    '/advertiser/:path*',
    '/admin/:path*',
    // Public static/marketing pages — middleware handles caching headers
    '/',
    '/pricing',
    '/comparison',
    '/faq',
    '/security',
    '/privacy',
    '/terms',
    '/payout-policy',
    '/advertiser-policy',
  ],
};
