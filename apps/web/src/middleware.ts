import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const PROTECTED_PREFIXES = ['/developer', '/advertiser', '/admin', '/settings'];

/**
 * Next.js middleware that gates protected routes on a real JWT check.
 *
 * Previously the session cookie was a static "1" sentinel — anyone who set
 * `document.cookie = 'session=1'` in their browser could access developer,
 * advertiser, and admin routes. The auth-context now writes the real JWT
 * access token into the session cookie, and this middleware verifies it
 * using the shared JWT_SECRET.
 *
 * Edge-runtime compatible: `jose` is zero-dependency and works in Next.js
 * Edge Middleware without polyfills.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only check protected paths
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const sessionCookie = request.cookies.get('session');
  const token = sessionCookie?.value;

  if (!token || token === '1') {
    // Either no session or the old static sentinel (migration path).
    // Redirect to login.
    return redirectToLogin(pathname, request);
  }

  try {
    // Verify the JWT access token. We use the same secret the NestJS
    // API server uses — configured via the same JWT_SECRET env var.
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    // Token expired, tampered, or forged — redirect to login.
    // The client will attempt a refresh via localStorage.refreshToken;
    // if that fails, it clears the cookie. Either way, the stale/forged
    // cookie doesn't grant access.
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
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (robots.txt, manifest.json, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};