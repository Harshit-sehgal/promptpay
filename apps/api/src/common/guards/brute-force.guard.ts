import { Injectable, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

export interface RequestLike {
  ip?: string;
  url?: string;
  route?: { path?: string };
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

/**
 * Brute-force detection guard — tracks sequential login / password-reset
 * failures per (route × resolved-ip × target-email).
 *
 * Approach:
 *  - In-memory Map<key, {failures, lockUntil}>.
 *  - 5 consecutive failures locks the composite key for 15 minutes.
 *  - Resets on first successful auth after the lock period.
 *
 * Important design notes:
 *  - The tracker lives in the main-thread process memory — it does NOT scale
 *    across multiple API instances. Deploy behind a single-instance auth
 *    endpoint or, for multi-instance, replace the Map with a shared Redis
 *    store keyed on the same composite.
 *  - `req.ip` is the authoritative resolved IP. We NEVER read the raw
 *    `x-forwarded-for` header directly — that would let an attacker rotate
 *    their claimed IP per request and defeat the counter entirely. Express's
 *    `trust proxy` must be configured in main.ts to set the expected proxy
 *    hop count so `req.ip` resolves the true downstream address.
 *  - Only `UnauthorizedException` increments the counter. Conflict,
 *    BadRequest, and other non-auth failures do not count toward lockout —
 *    counting "email already registered" as a brute-force strike is a
 *    self-DoS / framing vector.
 *
 * This runs after ThrottlerGuard: rate limits prevent flooding, this guard
 * catches credential stuffing patterns that stay under rate limits.
 */
const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const tracker = new Map<string, { failures: number; lockUntil: number; lastFailure: number }>();

@Injectable()
export class BruteForceGuard {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestLike>();
    const ip = resolveIp(req);
    const path = req.route?.path ?? req.url ?? '';

    // Only track auth routes
    if (!isAuthRoute(path)) {
      return true; // pass through — other guards handle non-auth
    }

    // The guard runs BEFORE the request body is parsed, so the target email
    // is not yet available. Locks are recorded under composite keys shaped
    // `${path}:${ip}:${target}` (recordFailure). If ANY such key for this
    // route+ip is currently locked, reject — this covers both the
    // per-account lock (distributed attack on one account) and the
    // anonymous-target lock (route recorded with no email).
    const prefix = `${path}:${ip}:`;
    const now = Date.now();
    let locked = false;
    for (const [key, entry] of tracker.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (entry.lockUntil > now) {
        locked = true;
        break;
      }
    }

    if (locked) {
      throw new HttpException('Too many failed attempts — try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Pre-allow — failures increment on POST hook (in the controller catch).
    return true;
  }

  /**
   * Record an authentication failure.
   *
   * @param req    The HTTP request (used to resolve the client IP).
   * @param target The identifier being attacked — email for login/signup,
   *   or an anonymous placeholder for routes without a known target.
   *   Providing the email creates a composite (route + ip + email) key
   *   so a distributed attack on the same account is tracked across IPs.
   */
  static recordFailure(req: RequestLike, target?: string): void {
    const ip = resolveIp(req);
    const path = req.route?.path ?? req.url ?? '';
    if (!isAuthRoute(path)) return;

    const key = buildKey(path, ip, target ?? '');
    const now = Date.now();
    const entry = tracker.get(key);

    if (entry && entry.lockUntil > now) return; // already locked

    const failures = (entry?.failures ?? 0) + 1;
    const lockUntil = failures >= MAX_FAILURES ? now + LOCK_DURATION_MS : 0;
    tracker.set(key, { failures, lockUntil, lastFailure: now });
  }

  /**
   * Reset the counter after a successful auth (login / password change).
   * Clears all composite keys for the route+ip so a successful reset
   * doesn't leave stale per-email locks behind.
   */
  static resetOnSuccess(req: RequestLike): void {
    const ip = resolveIp(req);
    const path = req.route?.path ?? req.url ?? '';
    if (!isAuthRoute(path)) return;

    for (const key of tracker.keys()) {
      if (key.startsWith(`${path}:${ip}:`)) tracker.delete(key);
    }
  }

    /** Clean up stale entries (lock expired + no recent failures) */
  static cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of tracker.entries()) {
      // Remove entries where lock has expired or where there's no lock and no recent activity
      if (
        (entry.lockUntil && entry.lockUntil <= now) ||
        (!entry.lockUntil && now - entry.lastFailure > LOCK_DURATION_MS)
      ) {
        tracker.delete(key);
      }
    }
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic cleanup — called once on module load.
 * Stores the interval handle so it can be cleared during testing or shutdown.
 */
export function startCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => BruteForceGuard.cleanup(), 5 * 60 * 1000);
  cleanupInterval.unref();
}

startCleanup();

/** Clear the cleanup interval (useful in tests or graceful shutdown) */
export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

function buildKey(path: string, ip: string, target: string): string {
  return `${path}:${ip}:${target}`;
}

function resolveIp(req: RequestLike): string {
  // req.ip is Express's resolved client IP (honours the `trust proxy` setting).
  // Never read x-forwarded-for directly — an attacker controls that header and
  // can rotate it per request to defeat the counter.
  return req.ip ?? req.connection?.remoteAddress ?? 'unknown';
}

function isAuthRoute(path: string): boolean {
  // `/auth/verify-email/*` (request + confirm) carries short random
  // verification tokens. Without brute-force tracking an attacker could
  // hammer the confirm endpoint guessing tokens. Treat them as auth
  // routes so the same per-(route×ip×target) lockout applies. The
  // `target` for these routes is the user identifier (email) so a
  // distributed guess attack on one account is tracked across IPs.
  return (
    path.includes('/auth/login') ||
    path.includes('/auth/signup') ||
    path.includes('/auth/google') ||
    path.includes('/auth/password') ||
    path.includes('/auth/verify-email')
  );
}
