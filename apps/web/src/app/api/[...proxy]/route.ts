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

/**
 * Maximum body size this proxy will accept (in bytes). Mirrors the
 * API server's `json({ limit: '100kb' })` in apps/api/src/main.ts.
 * Anything larger is rejected with 413 to prevent OOM/DoS — Next.js does
 * NOT implicitly cap `req.text()` the way built-in body parsers do.
 */
const MAX_PROXY_BODY_BYTES = 100_000;

/**
 * Path prefixes the proxy is permitted to forward. Anything not on this list
 * is rejected with 403. This prevents the browser from reaching admin-only
 * upstream endpoints not intended for the web UI (e.g. extension-specific
 * endpoints, internal health routes) even with a valid access token.
 *
 * Keep this in sync with `apps/web/src/lib/api/services.ts` — when a new
 * service method is added, the corresponding prefix must be added here or
 * the call will 403.
 */
const ALLOWED_PATH_PREFIXES = [
  // Auth (non-token-bearing endpoints that go through the proxy, not dedicated
  // Route Handlers)
  '/auth/me',
  '/auth/logout',
  '/auth/refresh',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/auth/verify-email/confirm',

  // Developer
  '/developer/dashboard',
  '/developer/earnings',
  '/developer/settings',
  '/developer/trust',
  '/developer/export-data',
  '/developer/api-keys',

  // Advertiser
  '/advertiser/dashboard',
  '/advertiser/campaigns',
  '/advertiser/reports',

  // Admin (gated by RoleGuard upstream; the proxy just forwards)
  '/admin/overview',
  '/admin/users',
  '/admin/campaigns',
  '/admin/payouts',
  '/admin/fraud',
  '/admin/recovery-debt',
  '/admin/audit-log',

  // Payout
  '/payout/method',
  '/payout/info',
  '/payout/request',
  '/payout/history',
  '/payout/available',

  // Ledger
  '/ledger/balance',
  '/ledger/breakdown',
  '/ledger/history',
  '/ledger/admin/breakdown',
  '/ledger/admin/history',

  // Referral
  '/referral',

  // Campaigns (shared — creative management from both advertiser + admin pages)
  '/campaigns',
];

function upstreamUrl(pathname: string): string {
  // `pathname` starts with `/api/...` — strip the `/api` prefix so the
  // upstream gets `/api/v1/...` which is what the API controller paths use
  // (global prefix `api/v1` then the controller path).
  const pathWithoutApi = pathname.replace(/^\/api/, '');
  return `${API_BASE}${pathWithoutApi}`;
}

function proxyPath(pathname: string): string {
  return pathname.replace(/^\/api/, '');
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
    const pathname = req.nextUrl.pathname;
    const pathWithoutApi = proxyPath(pathname);

    // Reject paths not on the explicit allowlist — the web UI never needs them
    // and they could reach upstream endpoints the browser shouldn't access.
    const allowed = ALLOWED_PATH_PREFIXES.some(
      (prefix) => pathWithoutApi === prefix || pathWithoutApi.startsWith(`${prefix}/`),
    );
    if (!allowed) {
      return NextResponse.json(
        { message: 'Forbidden', code: 'PROXY_PATH_NOT_ALLOWED' },
        { status: 403 },
      );
    }

    // ── Body-size guard (DoS prevention) ────────────────────────────────
    // Next.js does NOT implicitly cap `req.text()` on Route Handlers the
    // way it does for built-in body parsers. A 1GiB POST would cause a 1GiB
    // allocation in this Node worker before any auth check or upstream
    // dispatch fires. Reject oversized bodies up front, mirroring the API
    // server's 100kb limit (apps/api/src/main.ts body-parser caps).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const contentLengthRaw = req.headers.get('content-length');
      if (contentLengthRaw) {
        const contentLength = Number(contentLengthRaw);
        if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BODY_BYTES) {
          return NextResponse.json(
            { message: 'Payload too large', code: 'BODY_TOO_LARGE' },
            { status: 413, headers: { 'X-Max-Body-Bytes': String(MAX_PROXY_BODY_BYTES) } },
          );
        }
      }
    }

    const url = upstreamUrl(pathname);
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
        // Enforce the actual byte length after read in case the client omitted
        // Content-Length (transfer-encoding: chunked). If the buffered body
        // exceeds MAX_PROXY_BODY_BYTES, refuse to forward.
        body = await req.text();

        // First-line defense: explicit cap on byte-length (Content-Length
        // header may lie). Reject anything past the limit before forwarding.
        if (body && Buffer.byteLength(body, 'utf-8') > MAX_PROXY_BODY_BYTES) {
          return NextResponse.json(
            { message: 'Payload too large', code: 'BODY_TOO_LARGE' },
            { status: 413, headers: { 'X-Max-Body-Bytes': String(MAX_PROXY_BODY_BYTES) } },
          );
        }

        // Intercept /auth/refresh: the browser can't read the httpOnly
        // refresh_token cookie, so it sends an empty body. The proxy
        // reads the cookie and injects it into the API-compatible body.
        if (url.endsWith('/auth/refresh') && refreshToken) {
          // The API expects { refreshToken }
          body = JSON.stringify({ refreshToken });
        }
      } catch (parseErr) {
        console.warn('[WaitLayer] Proxy body parse failed:', parseErr instanceof Error ? parseErr.message : String(parseErr));
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
      // Recursively strip sensitive fields that should never reach the browser.
      // The auth Route Handlers already strip tokens from login/signup/google
      // responses, but this is an independent defense-in-depth guard in case
      // any non-auth upstream endpoint accidentally projects a token or secret.
      responseBody = stripSensitiveFields(responseBody);
    } else {
      responseBody = await upstreamRes.text();
    }

    return NextResponse.json(responseBody, { status: responseStatus });
  } catch (proxyErr) {
    console.error('[WaitLayer] Proxy error:', proxyErr instanceof Error ? proxyErr.message : String(proxyErr));
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Recursively delete `accessToken`, `refreshToken`, `password`, `passwordHash`,
 * and `secret` keys from an arbitrary JSON value. This is defense-in-depth:
 * the auth Route Handlers already strip tokens from login/signup/google/refresh
 * responses, but a non-auth endpoint that accidentally projects a secret should
 * not leak it through the catch-all proxy.
 */
const SENSITIVE_FIELDS = new Set([
  'accessToken',
  'refreshToken',
  'password',
  'passwordHash',
  'secret',
  'eventSecret',
]);

function stripSensitiveFields(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(stripSensitiveFields);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const stripped: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (SENSITIVE_FIELDS.has(key)) continue;
      stripped[key] = stripSensitiveFields(obj[key]);
    }
    return stripped;
  }
  return value;
}
