import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { PrismaService } from '../config/prisma.service';

/** Archives only expired, unconsumed nonce sessions. A served impression may
 * restrict deletion of its session, so archival is both reliable and keeps an
 * audit trail without ever treating the nonce as consumed. */
@Injectable()
export class WaitAttestationCleanupCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WaitAttestationCleanupCron.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (!backgroundJobsEnabled()) return;
    void this.runCleanup();
    this.timer = setInterval(() => void this.runCleanup(), 60 * 60 * 1000);
  }

  async runCleanup(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const archived = await this.prisma.waitAttestationSession.updateMany({
        where: { consumedAt: null, expiredAt: null, consumeDeadline: { lt: new Date() } },
        data: { expiredAt: new Date() },
      });
      if (archived.count) {
        this.logger.log(`Archived ${archived.count} expired unconsumed wait attestations`);
      }
      return archived.count;
    } catch (error) {
      this.logger.error('Wait-attestation cleanup failed', error instanceof Error ? error.stack : String(error));
      return 0;
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
