import { errors, importSPKI, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

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
 * Next.js proxy that gates protected routes on the httpOnly
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
 *       by JavaScript at all. The proxy verifies the httpOnly `access_token`
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
 * Resolve the JWT verification keys for Edge middleware.
 *
 * Unlike the NestJS API (Node runtime, reads env at process start), Next.js
 * Edge middleware inlines `process.env` values at *build* time. A value that
 * is only injected at container/serverless *runtime* therefore appears as
 * `undefined` here. `JWT_PUBLIC_KEY` is the current signing key and
 * `JWT_PUBLIC_KEYS` carries additional accepted keys during rotation. Both must
 * be build inputs so old and new sessions overlap for the longest token TTL.
 */
let cachedRawKeySet: string | undefined;
let cachedPublicKeysPromise: Promise<CryptoKey[]> | undefined;

function splitPublicKeys(raw: string): string[] {
  const normalized = raw.replace(/\\n/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g);
  return (blocks ?? [normalized]).map((pem) => pem.trim());
}

async function getJwtPublicKeys(): Promise<CryptoKey[]> {
  const primary = process.env.JWT_PUBLIC_KEY ?? '';
  const additional = process.env.JWT_PUBLIC_KEYS ?? '';
  const rawKeySet = `${primary}\u0000${additional}`;
  const pems = [...new Set([...splitPublicKeys(primary), ...splitPublicKeys(additional)])];

  if (pems.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[waitlayer] JWT_PUBLIC_KEY/JWT_PUBLIC_KEYS are missing in the web middleware. ' +
          'Verification keys must be present at build time (Edge runtime inlines env vars). ' +
          'All protected routes will fail closed.',
      );
    }
    return [];
  }

  if (!cachedPublicKeysPromise || cachedRawKeySet !== rawKeySet) {
    cachedRawKeySet = rawKeySet;
    cachedPublicKeysPromise = Promise.all(
      pems.map(async (pem) => {
        try {
          return await importSPKI(pem, 'RS256');
        } catch (err) {
          console.error('[waitlayer] JWT verification key is invalid SPKI/PEM:', err);
          return null;
        }
      }),
    ).then((keys) => keys.filter((key): key is CryptoKey => key !== null));
  }
  return cachedPublicKeysPromise;
}

async function verifyJwtWithConfiguredKeys(
  token: string,
  options: Parameters<typeof jwtVerify>[2],
) {
  const publicKeys = await getJwtPublicKeys();
  let lastError: unknown = new Error('No valid JWT verification key is configured');

  for (const publicKey of publicKeys) {
    try {
      return await jwtVerify(token, publicKey, options);
    } catch (err) {
      // An expired token had a valid signature. Preserve that signal so the
      // access-token path can fall back to a valid refresh cookie.
      if (err instanceof errors.JWTExpired) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

export async function proxy(request: NextRequest) {
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
  // redirect). A valid refresh cookie is one signed by our own JWT_PRIVATE_KEY —
  // even if expired, the client-side interceptor will silently refresh it.
  // Anything else (bad signature, malformed) is treated as absent.
  const hasValidRefresh = async (): Promise<boolean> => {
    if (!refreshCookie?.value) return false;
    try {
      const { payload, protectedHeader } = await verifyJwtWithConfiguredKeys(refreshCookie.value, {
        algorithms: ['RS256'],
        issuer: process.env.JWT_ISSUER || 'waitlayer',
        audience: process.env.JWT_AUDIENCE || 'waitlayer-client',
        clockTolerance: '30s',
      });
      if (protectedHeader.typ !== 'JWT' || !protectedHeader.kid) {
        return false;
      }
      const audience = payload.aud;
      return (
        (typeof audience === 'string'
          ? audience === 'refresh'
          : Boolean(audience?.includes('refresh'))) &&
        Boolean(payload.sub) &&
        Boolean(payload.jti)
      );
    } catch {
      return false;
    }
  };

  if (!token) {
    if (await hasValidRefresh()) {
      return NextResponse.next();
    }
    return redirectToLogin(pathname, request);
  }

  try {
    // Verify against the current + rotation public-key set inlined at build
    // time. Tolerate a small clock skew so a brief token-expiry boundary does
    // not bounce users. If no configured key verifies, fail closed.
    const { payload, protectedHeader } = await verifyJwtWithConfiguredKeys(token, {
      algorithms: ['RS256'],
      issuer: process.env.JWT_ISSUER || 'waitlayer',
      audience: process.env.JWT_AUDIENCE || 'waitlayer-client',
      clockTolerance: '30s',
    });
    if (protectedHeader.typ !== 'JWT' || !protectedHeader.kid) {
      return redirectToLogin(pathname, request);
    }
    const audience = payload.aud;
    if (
      !audience ||
      (typeof audience === 'string' ? audience !== 'access' : !audience.includes('access')) ||
      !payload.sub ||
      !payload.jti
    ) {
      return redirectToLogin(pathname, request);
    }
    return NextResponse.next();
  } catch (err) {
    if (err instanceof errors.JWTExpired && (await hasValidRefresh())) {
      return NextResponse.next();
    }
    return redirectToLogin(pathname, request);
  }
}

function redirectToLogin(pathname: string, request: NextRequest): NextResponse {
  const loginUrl = new URL('/auth/login', request.url);
  loginUrl.searchParams.set('returnTo', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match only protected prefix paths so the proxy (including jose JWT
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
    // Public static/marketing pages — the proxy handles caching headers
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
