import { Injectable, Logger,OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { PrismaService } from '../config/prisma.service';

/**
 * Periodically prunes expired Session rows. Without this, sessions whose
 * JWT has expired but whose DB row was never revoked (e.g. user logged in
 * once and never rotated) accumulate forever — at one row per session per
 * user plus refreshes, this is a slow table-bloat DoS vector that takes
 * months to become visible. Once pruned, the row is inert (the JWT alone
 * governs token validity via its own `exp` claim) — this is purely
 * storage hygiene.
 */
@Injectable()
export class SessionCleanupCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupCron.name);
  private intervalId?: NodeJS.Timeout;

  // Run every hour. The `expiresAt` of a session row is the same instant the
  // refresh JWT expires, and the JWT strategy refuses tokens past their own
  // `exp` before touching the row — so a row whose `expiresAt` has passed is
  // already inert (no request can present a refresh token that still verifies).
  // We delete at `expiresAt + GRACE_MS` purely as a conservative retention
  // buffer for FK-audit / forensic queries (e.g. an admin reviewing an old
  // session row's `tokenFamily` after a token-reuse detection event). This is
  // NOT, as an earlier comment claimed, a guard against racing an in-flight
  // rotation — that race can't occur because the JWT layer rejects the
  // already-expired refresh token before any DB write.
  private static readonly INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting session cleanup cron...');
    // Fire-and-forget the startup cleanup: awaiting it here would block
    // server readiness until the query completes (or the DB hangs), and the
    // cleanup is purely storage hygiene — delayed by a few seconds it's
    // invisible to any client path. Errors are already logged inside
    // runCleanup(), so the void catch is purely for the TS compiler's
    // unhandled-rejection concern.
    void this.runCleanup().catch(() => {
      // runCleanup already logs errors — nothing to add.
    });

    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, SessionCleanupCron.INTERVAL_MS);
  }

  private async runCleanup() {
    try {
      const cutoff = new Date(Date.now() - SessionCleanupCron.GRACE_MS);
      const result = await this.prisma.session.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.log(`Pruned ${result.count} expired session(s) (cutoff=${cutoff.toISOString()})`);
      }
    } catch (err) {
      // Cron errors must not crash the app — log and continue.
      this.logger.error('Session cleanup cron failed', err instanceof Error ? err.stack : String(err));
    }
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.logger.log('Session cleanup cron stopped.');
    }
  }
}
