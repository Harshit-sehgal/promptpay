import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { PrismaService } from '../config/prisma.service';

/** Removes only expired, unconsumed nonce sessions. Consumed sessions and their
 * attestation records remain under the financial retention policy. */
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
      const removed = await this.prisma.waitAttestationSession.deleteMany({
        where: { consumedAt: null, consumeDeadline: { lt: new Date() } },
      });
      if (removed.count) this.logger.log(`Pruned ${removed.count} expired unconsumed wait attestations`);
      return removed.count;
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
