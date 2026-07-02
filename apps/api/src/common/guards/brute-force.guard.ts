import { Injectable, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

export interface RequestLike {
  ip?: string;
  url?: string;
  route?: { path?: string };
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

/**
 * Brute-force detection guard — tracks sequential login failures.
 *
 * Approach:
 *  - In-memory Map<(route+ip), {failures, lockUntil}>.
 *  - 5 consecutive failures on auth/* routes locks the IP for 15 minutes.
 *  - Resets on first successful auth after protection period.
 *
 * This runs after ThrottlerGuard: rate limits prevent flooding, this guard
 * catches credential stuffing patterns that stay under rate limits.
 */
const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const tracker = new Map<string, { failures: number; lockUntil: number }>();

@Injectable()
export class BruteForceGuard {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestLike>();
    const ip = resolveIp(req);
    const key = `${req.route?.path ?? req.url}:${ip}`;

    // Only track auth routes
    if (!isAuthRoute(req.route?.path ?? req.url ?? '')) {
      return true; // pass through — other guards handle non-auth
    }

    const entry = tracker.get(key);
    const now = Date.now();

    if (entry) {
      if (entry.lockUntil > now) {
        throw new HttpException('Too many failed attempts — try again later', HttpStatus.TOO_MANY_REQUESTS);
      }
      // Lock expired — clear and allow
      tracker.delete(key);
    }

    // Pre-allow — failures increment on POST hook
    return true;
  }

  /** Call on login failure */
  static recordFailure(req: RequestLike): void {
    const ip = resolveIp(req);
    const path = req.route?.path ?? req.url ?? '';
    if (!isAuthRoute(path)) return;

    const key = `${path}:${ip}`;
    const now = Date.now();
    const entry = tracker.get(key);

    if (entry && entry.lockUntil > now) return; // already locked

    const failures = (entry?.failures ?? 0) + 1;
    const lockUntil = failures >= MAX_FAILURES ? now + LOCK_DURATION_MS : 0;
    tracker.set(key, { failures, lockUntil });
  }

  /** Call on login success — reset counter */
  static resetOnSuccess(req: RequestLike): void {
    const ip = resolveIp(req);
    const path = req.route?.path ?? req.url ?? '';
    if (!isAuthRoute(path)) return;

    const key = `${path}:${ip}`;
    tracker.delete(key);
  }
  /** Clean up stale entries (lock expired + no recent failures) */
  static cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of tracker.entries()) {
      // Remove entries where lock has expired or where there's no lock and no recent activity
      if (entry.lockUntil && entry.lockUntil <= now) {
        tracker.delete(key);
      }
    }
  }
}

// Periodic cleanup every 5 minutes to prevent unbounded memory growth
setInterval(() => BruteForceGuard.cleanup(), 5 * 60 * 1000);

function resolveIp(req: RequestLike): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return req.ip ?? forwardedIp?.split(',')[0]?.trim() ?? req.connection?.remoteAddress ?? 'unknown';
}

function isAuthRoute(path: string): boolean {
  return (
    path.includes('/auth/login') ||
    path.includes('/auth/signup') ||
    path.includes('/auth/google') ||
    path.includes('/auth/password')
  );
}
