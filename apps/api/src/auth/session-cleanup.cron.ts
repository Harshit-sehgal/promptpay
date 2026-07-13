import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

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
  private running = false;

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
  private static readonly BATCH_SIZE = 500;
  private static readonly MAX_BATCHES_PER_RUN = 10;

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
      void this.runCleanup().catch(() => {
        // runCleanup logs operational failures and keeps the next tick alive.
      });
    }, SessionCleanupCron.INTERVAL_MS);
  }

  async runCleanup(): Promise<{ acquired: boolean; deleted: number }> {
    if (this.running) {
      this.logger.warn('Session cleanup already in flight — skipping overlapping run');
      return { acquired: false, deleted: 0 };
    }
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - SessionCleanupCron.GRACE_MS);
      const result = await this.prisma.$transaction(
        async (tx) => {
          const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext('waitlayer-session-cleanup')) AS "acquired"
          `;
          if (!lockRows[0]?.acquired) return { acquired: false, deleted: 0 };

          let deleted = 0;
          for (let batch = 0; batch < SessionCleanupCron.MAX_BATCHES_PER_RUN; batch++) {
            const count = await tx.$executeRaw`
              WITH doomed AS (
                SELECT "id" FROM "sessions"
                WHERE "expiresAt" < ${cutoff}
                ORDER BY "expiresAt", "id"
                LIMIT ${SessionCleanupCron.BATCH_SIZE}
              )
              DELETE FROM "sessions" target
              USING doomed
              WHERE target."id" = doomed."id"
            `;
            deleted += count;
            if (count < SessionCleanupCron.BATCH_SIZE) break;
          }
          return { acquired: true, deleted };
        },
        { timeout: 30_000 },
      );
      if (!result.acquired) {
        this.logger.warn('Session cleanup is running on another replica — skipping this tick');
      } else if (result.deleted > 0) {
        this.logger.log(
          `Pruned ${result.deleted} expired session(s) (cutoff=${cutoff.toISOString()})`,
        );
      }
      return result;
    } catch (err) {
      // Cron errors must not crash the app — log and continue.
      this.logger.error(
        'Session cleanup cron failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { acquired: false, deleted: 0 };
    } finally {
      this.running = false;
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
