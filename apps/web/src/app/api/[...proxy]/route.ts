import { NextRequest, NextResponse } from 'next/server';

import {
  apiBaseUrl,
  applyRateLimitIdentity,
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  isSecure,
  rateLimitIdentity,
  readAuthCookie,
} from '../auth/_lib/cookies';
import {
  MAX_API_ROUTE_BODY_BYTES,
  readLimitedTextBody,
  rejectCrossOriginMutation,
} from '../auth/_lib/request-guards';

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

/**
 * Maximum body size this proxy will accept (in bytes). Mirrors the
 * API server's `json({ limit: '100kb' })` in apps/api/src/main.ts.
 * Anything larger is rejected with 413 to prevent OOM/DoS — Next.js does
 * NOT implicitly cap `req.text()` the way built-in body parsers do.
 */
const MAX_PROXY_BODY_BYTES = MAX_API_ROUTE_BODY_BYTES;

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
export const ALLOWED_PATH_PREFIXES = [
  // Auth (non-token-bearing endpoints that go through the proxy, not dedicated
  // Route Handlers)
  '/auth/me',
  '/auth/logout',
  '/auth/refresh',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/auth/verify-email/confirm',
  '/auth/verify-email/request',
  '/auth/2fa/setup',
  '/auth/2fa/enable',
  '/auth/2fa/disable',
  '/auth/2fa/backup-codes/regenerate',
  '/auth/link/google',
  '/auth/password/set',
  '/auth/sessions',

  // Developer
  '/developer/dashboard',
  '/developer/earnings',
  '/developer/settings',
  '/developer/trust',
  '/developer/export-data',
  '/developer/api-keys',
  '/developer/delete-account',

  // Advertiser
  '/advertiser/dashboard',
  '/advertiser/billing',
  '/advertiser/campaigns',
  '/advertiser/reports',
  '/advertiser/deposit-session',
  '/advertiser/export-data',
  '/advertiser/delete-account',

  // Admin (gated by RoleGuard upstream; the proxy just forwards)
  '/admin/overview',
  '/admin/money-integrity',
  '/admin/metrics',
  '/admin/users',
  '/admin/campaigns',
  '/admin/devices',
  '/admin/payouts',
  '/admin/fraud',
  '/admin/recovery-debt',
  '/admin/audit-log',
  '/admin/tools',
  '/admin/webhooks',
  '/admin/refunds',
  '/admin/payout-accounts',

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

  // Health check
  '/health',

  // Campaigns (shared — creative management from both advertiser + admin pages)
  '/campaigns',

  // Compliance / consent (re-prompt flow #65)
  '/consent',

  // Feedback (public submission)
  '/feedback',
];

function upstreamUrl(pathname: string, search = ''): string {
  // `pathname` starts with `/api/...` — strip the `/api` prefix so the
  // upstream gets `/api/v1/...` which is what the API controller paths use
  // (global prefix `api/v1` then the controller path).
  const pathWithoutApi = pathname.replace(/^\/api/, '');
  return `${apiBaseUrl()}${pathWithoutApi}${search}`;
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
    const blockedOrigin = rejectCrossOriginMutation(req);
    if (blockedOrigin) return blockedOrigin;

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

    const url = upstreamUrl(pathname, req.nextUrl.search);
    const identity = rateLimitIdentity(req);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...identity.headers,
    };

    // Forward the access token from the httpOnly cookie as a Bearer header
    const accessToken = readAuthCookie(req, COOKIE_ACCESS, isSecure(req.headers));
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Pick up the refresh token for auth/refresh calls below
    const refreshToken = readAuthCookie(req, COOKIE_REFRESH, isSecure(req.headers));

    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      try {
        // Next.js Route Handlers do not implicitly cap request bodies. Read
        // the stream through a byte counter so oversized chunked uploads stop
        // before the worker buffers the full payload.
        const bodyResult = await readLimitedTextBody(req, MAX_PROXY_BODY_BYTES);
        if (!bodyResult.ok) return bodyResult.response;
        body = bodyResult.text;

        // Intercept /auth/refresh: the browser can't read the httpOnly
        // refresh_token cookie, so it sends an empty body. The proxy
        // reads the cookie and injects it into the API-compatible body.
        if (url.endsWith('/auth/refresh') && refreshToken) {
          // The API expects { refreshToken }
          body = JSON.stringify({ refreshToken });
        }
      } catch (parseErr) {
        console.warn(
          '[WaitLayer] Proxy body parse failed:',
          parseErr instanceof Error ? parseErr.message : String(parseErr),
        );
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
      //
      // Exception: `/auth/2fa/setup` intentionally returns the TOTP `secret`
      // (and `otpauthUrl`) so the user can copy it manually when they cannot
      // scan the QR code. We preserve only those two fields for that exact
      // route — every other route still has `secret` stripped (including the
      // `eventSecret` used for device signing).
      const allowSetupSecret = pathWithoutApi === '/auth/2fa/setup';
      const allowBackupCodes =
        pathWithoutApi === '/auth/2fa/enable' ||
        pathWithoutApi === '/auth/2fa/backup-codes/regenerate';
      responseBody = stripSensitiveFields(responseBody, allowSetupSecret, allowBackupCodes);
      return applyRateLimitIdentity(
        NextResponse.json(responseBody, { status: responseStatus }),
        identity,
        req.headers,
      );
    }

    // Non-JSON upstream responses (e.g. CSV exports) are forwarded verbatim
    // with their original content-type so the browser can download them
    // directly instead of wrapping plain text in a JSON envelope.
    const textBody = await upstreamRes.text();
    return applyRateLimitIdentity(
      new NextResponse(textBody, {
        status: responseStatus,
        headers: { 'Content-Type': contentType || 'text/plain' },
      }),
      identity,
      req.headers,
    );
  } catch (proxyErr) {
    console.error(
      '[WaitLayer] Proxy error:',
      proxyErr instanceof Error ? proxyErr.message : String(proxyErr),
    );
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Recursively delete sensitive keys from an arbitrary JSON value. This is
 * defense-in-depth: the auth Route Handlers already strip tokens from
 * login/signup/google/refresh responses, but a non-auth endpoint that
 * accidentally projects a secret should not leak it through the catch-all
 * proxy.
 *
 * The set covers the obvious tokens (`accessToken`, `refreshToken`,
 * `password(Hash)`) plus a broad family of secret-shaped field names that
 * endpoints sometimes project by accident: API keys/secrets, private keys,
 * cloud credential pairs, reset/verification tokens, mnemonics/seed phrases,
 * and one-time recovery codes.
 *
 * KEEPING THIS CURRENT: when a new API endpoint returns a new sensitive-shaped
 * field name not already in this set, add it here. The proxy is a single choke
 * point; one line added here strips the field from every non-allowlisted route.
 * Audit cadence: grep API DTO/trait/controller return shapes for `secret`,
 * `key`, `token`, `credential`, `password`, `private`, `mnemonic`, `seed`,
 * `recovery` at least once per quarter.
 *
 * Deliberately NOT in this set (one-time display fields):
 *   - `recoverySupportToken` — admin device recovery flow surfaces this once
 *   - `plainKey` — API-key creation surfaces this once
 *   - `otpauthUrl` — TOTP setup QR URI
 *   - `backupCodes` — 2FA enable/regenerate one-time display
 *
 * Deliberately NOT in this set (stripped earlier in the pipeline):
 *   - `twoFactorSecret` — `sanitizeUser` already omits it from every auth response
 *   - `twoFactorBackupCodeHashes` — never returned to the browser
 *   - `passwordHash` — never returned to the browser; `sanitizeUser` strips it
 */
const SENSITIVE_FIELDS = new Set([
  'accessToken',
  'refreshToken',
  'password',
  'passwordHash',
  'secret',
  'eventSecret',
  'token',
  'apiKey',
  'apiSecret',
  'privateKey',
  'private_key',
  'secretKey',
  'secret_key',
  'accessKey',
  'access_key',
  'accessKeyId',
  'secretAccessKey',
  'secret_access_key',
  'clientSecret',
  'client_secret',
  'resetToken',
  'resetPasswordToken',
  'passwordResetToken',
  'verificationToken',
  'emailVerificationToken',
  'mnemonic',
  'mnemonicPhrase',
  'seedPhrase',
  'recoveryCode',
  'otpSecret',
  'recoverySeed',
]);

export function stripSensitiveFields(
  value: unknown,
  allowSetupSecret = false,
  allowBackupCodes = false,
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripSensitiveFields(v, allowSetupSecret, allowBackupCodes));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const stripped: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      // The 2FA setup endpoint is the single route allowed to surface a TOTP
      // `secret` (and its `otpauthUrl`) to the logged-in user. No other route
      // may leak a `secret`/`eventSecret` through the proxy.
      if (allowSetupSecret && (key === 'secret' || key === 'otpauthUrl')) {
        stripped[key] = obj[key];
        continue;
      }
      if (allowBackupCodes && key === 'backupCodes') {
        stripped[key] = obj[key];
        continue;
      }
      if (SENSITIVE_FIELDS.has(key)) continue;
      stripped[key] = stripSensitiveFields(obj[key], allowSetupSecret, allowBackupCodes);
    }
    return stripped;
  }
  return value;
}

/** Whether the proxy is permitted to forward an upstream path (after the
 *  `/api` prefix is stripped). Exported for tests (A-006). */
export function isProxyPathAllowed(pathWithoutApi: string): boolean {
  return ALLOWED_PATH_PREFIXES.some(
    (prefix) => pathWithoutApi === prefix || pathWithoutApi.startsWith(`${prefix}/`),
  );
}
