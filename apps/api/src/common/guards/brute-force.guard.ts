import { Injectable, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

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
    const req = context.switchToHttp().getRequest();
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
        return false; // locked — guards will reject request
      }
    }

    // Pre-allow — failures increment on POST hook
    return true;
  }

  /** Call on login failure */
  static recordFailure(req: Record<string, any>): void {
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
  static resetOnSuccess(req: Record<string, any>): void {
    const ip = resolveIp(req);
    const path = req.route?.path ?? req.url ?? '';
    if (!isAuthRoute(path)) return;

    const key = `${path}:${ip}`;
    tracker.delete(key);
  }
}

function resolveIp(req: Record<string, any>): string {
  return (
    req.ip ??
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
    req.connection?.remoteAddress ??
    'unknown'
  );
}

function isAuthRoute(path: string): boolean {
  return path.includes('/auth/login') || path.includes('/auth/signup');
}