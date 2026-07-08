import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RedisWindowCounter } from '../rate-limit/redis-window-counter';

export interface RequestLike {
  ip?: string;
  url?: string;
  originalUrl?: string;
  route?: { path?: string };
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

/**
 * Brute-force detection guard. It tracks auth failures by route+IP and, when
 * a target is known, by route+target. The target dimension catches distributed
 * attacks against one account; the IP dimension catches one source trying many
 * accounts.
 *
 * Approach:
 *  - Redis-backed counters when REDIS_URL is configured.
 *  - In-memory fallback for local/test runs without Redis.
 *  - Production fails closed if Redis is configured but unavailable.
 *  - 5 failures locks the key for 15 minutes.
 *
 * Important design notes:
 *  - Redis keys contain hashes of IPs and targets, not raw addresses/emails.
 *  - `req.ip` is the authoritative resolved IP. We never read the raw
 *    `x-forwarded-for` header directly because an attacker controls it.
 *    Express's `trust proxy` must be configured in main.ts so `req.ip`
 *    resolves the expected downstream address.
 *  - Controllers decide which failures increment the counter. Password/token
 *    credential failures count; business validation such as "email already
 *    registered" must not, because that would create a self-DoS / framing
 *    vector.
 *
 * This runs after ThrottlerGuard: rate limits prevent flooding, this guard
 * catches credential stuffing patterns that stay under rate limits.
 */
const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const REDIS_NAMESPACE = 'wl:bruteforce';

const tracker = new Map<string, { failures: number; lockUntil: number; lastFailure: number }>();
let redisCounter: RedisWindowCounter | null = null;
let configuredRedisUrl: string | undefined;
let failClosed = false;

@Injectable()
export class BruteForceGuard implements CanActivate, OnApplicationShutdown {
  constructor(config: ConfigService) {
    BruteForceGuard.configure(config);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestLike>();
    await BruteForceGuard.assertCanAttempt(req);
    return true;
  }

  /** NestJS lifecycle hook: runs when the application receives SIGTERM/SIGINT. */
  onApplicationShutdown(_signal?: string): Promise<void> {
    return BruteForceGuard.shutdown();
  }

  static shutdown(): Promise<void> {
    return shutdownGuard();
  }

  static configure(config: ConfigService): void {
    const redisUrl = config.get<string>('REDIS_URL');
    const nodeEnv = config.get<string>('NODE_ENV');
    this.configureRuntime(redisUrl, nodeEnv === 'production');
  }

  static configureForTests(options: { redisUrl?: string; nodeEnv?: string } = {}): void {
    this.configureRuntime(options.redisUrl, options.nodeEnv === 'production');
  }

  static async resetForTests(): Promise<void> {
    tracker.clear();
    await shutdownGuard();
    failClosed = false;
  }

  static async assertCanAttempt(req: RequestLike, target?: string): Promise<void> {
    const path = resolvePath(req);
    if (!isAuthRoute(path)) return;

    const keys = buildAttemptKeys(path, resolveIp(req), target);
    const isLocked = await this.withLimiter(
      async (counter) => {
        const states = await Promise.all(keys.map((key) => counter.isBlocked(key)));
        return states.some((state) => state.blocked);
      },
      () => keys.some((key) => isMemoryLocked(key)),
    );

    if (isLocked) {
      throw new HttpException('Too many failed attempts - try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Record an authentication failure.
   *
   * @param req The HTTP request (used to resolve the client IP).
   * @param target The identifier being attacked - email for login/signup, or
   * an anonymous placeholder for routes without a known target. Providing the
   * email also increments a route+target key so a distributed attack on the
   * same account is tracked across IPs.
   */
  static async recordFailure(req: RequestLike, target?: string): Promise<void> {
    const path = resolvePath(req);
    if (!isAuthRoute(path)) return;

    const keys = buildAttemptKeys(path, resolveIp(req), target);
    await this.withLimiter(
      async (counter) => {
        await Promise.all(
          keys.map((key) => counter.hit(key, LOCK_DURATION_MS, MAX_FAILURES - 1, LOCK_DURATION_MS)),
        );
      },
      () => {
        for (const key of keys) recordMemoryFailure(key);
      },
    );
  }

  /**
   * Reset counters after successful auth. This clears the route+IP key and,
   * when a target is known, the route+target key.
   */
  static async resetOnSuccess(req: RequestLike, target?: string): Promise<void> {
    const path = resolvePath(req);
    if (!isAuthRoute(path)) return;

    const keys = buildAttemptKeys(path, resolveIp(req), target);
    await this.withLimiter(
      async (counter) => {
        await counter.reset(keys);
      },
      () => {
        for (const key of keys) tracker.delete(key);
      },
    );
  }

  /** Clean up stale in-memory entries (lock expired + no recent failures). */
  static cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of tracker.entries()) {
      if (
        (entry.lockUntil && entry.lockUntil <= now) ||
        (!entry.lockUntil && now - entry.lastFailure > LOCK_DURATION_MS)
      ) {
        tracker.delete(key);
      }
    }
  }

  private static configureRuntime(redisUrl: string | undefined, shouldFailClosed: boolean): void {
    failClosed = shouldFailClosed;
    if (!redisUrl) {
      redisCounter = null;
      configuredRedisUrl = undefined;
      return;
    }

    if (configuredRedisUrl === redisUrl && redisCounter) return;
    redisCounter = new RedisWindowCounter(redisUrl, REDIS_NAMESPACE);
    configuredRedisUrl = redisUrl;
  }

  private static async withLimiter<T>(
    redisOperation: (counter: RedisWindowCounter) => Promise<T>,
    memoryFallback: () => T | Promise<T>,
  ): Promise<T> {
    if (!redisCounter) {
      if (failClosed) {
        throw new HttpException('Authentication rate limiter unavailable', HttpStatus.SERVICE_UNAVAILABLE);
      }
      return memoryFallback();
    }

    try {
      return await redisOperation(redisCounter);
    } catch {
      if (failClosed) {
        throw new HttpException('Authentication rate limiter unavailable', HttpStatus.SERVICE_UNAVAILABLE);
      }
      return memoryFallback();
    }
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic cleanup - called once on module load.
 * Stores the interval handle so it can be cleared during testing or shutdown.
 */
export function startCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => BruteForceGuard.cleanup(), 5 * 60 * 1000);
  cleanupInterval.unref();
}

startCleanup();

/** Clear the cleanup interval (useful in tests or graceful shutdown). */
export function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Full shutdown: clears the cleanup interval AND disconnects the Redis
 * counter. Called by NestJS's OnApplicationShutdown lifecycle via the guard
 * instance, and by tests via `resetForTests()`.
 */
export async function shutdownGuard(): Promise<void> {
  stopCleanup();
  const counter = redisCounter;
  redisCounter = null;
  configuredRedisUrl = undefined;
  if (counter) {
    await counter.disconnect().catch(() => undefined);
  }
}

function buildAttemptKeys(path: string, ip: string, target?: string): string[] {
  const routeKey = hashValue(path);
  const keys = [`route:${routeKey}:ip:${hashValue(ip)}`];
  const normalizedTarget = normalizeTarget(target);
  if (normalizedTarget) {
    keys.push(`route:${routeKey}:target:${hashValue(normalizedTarget)}`);
  }
  return keys;
}

function isMemoryLocked(key: string): boolean {
  const entry = tracker.get(key);
  if (!entry) return false;
  const now = Date.now();
  if (entry.lockUntil > now) return true;
  if (entry.lockUntil && entry.lockUntil <= now) tracker.delete(key);
  return false;
}

function recordMemoryFailure(key: string): void {
  const now = Date.now();
  const entry = tracker.get(key);

  if (entry && entry.lockUntil > now) return;

  const failures = (entry?.failures ?? 0) + 1;
  const lockUntil = failures >= MAX_FAILURES ? now + LOCK_DURATION_MS : 0;
  tracker.set(key, { failures, lockUntil, lastFailure: now });
}

function resolvePath(req: RequestLike): string {
  const rawPath = req.originalUrl ?? req.route?.path ?? req.url ?? '';
  return rawPath.split('?')[0];
}

function resolveIp(req: RequestLike): string {
  // req.ip is Express's resolved client IP (honours the `trust proxy` setting).
  // Never read x-forwarded-for directly - an attacker controls that header and
  // can rotate it per request to defeat the counter.
  return req.ip ?? req.connection?.remoteAddress ?? 'unknown';
}

function normalizeTarget(target?: string): string {
  return target?.trim().toLowerCase() ?? '';
}

function hashValue(value: string): string {
  return createHash('sha256').update(value || 'unknown').digest('hex');
}

function isAuthRoute(path: string): boolean {
  // `/auth/verify-email/*` (request + confirm) carries short random
  // verification tokens. Without brute-force tracking an attacker could
  // hammer the confirm endpoint guessing tokens. Treat them as auth routes so
  // the same route+IP lockout applies.
  return (
    path.includes('/auth/login') ||
    path.includes('/auth/signup') ||
    path.includes('/auth/google') ||
    path.includes('/auth/password') ||
    path.includes('/auth/2fa') ||
    path.includes('/auth/verify-email')
  );
}
