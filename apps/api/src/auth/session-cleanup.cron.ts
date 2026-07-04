import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common';
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

  // Run every hour. Take a 7d grace window beyond `expiresAt` so we never
  // race an in-flight rotation that just refreshed the session row.
  private static readonly INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting session cleanup cron...');
    // Run once on startup so an idle deployment doesn't carry stale rows.
    await this.runCleanup();

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
