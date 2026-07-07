import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../config/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    const checks: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };

    // Database connectivity check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'connected';
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Health check: database unreachable');
    }

    return checks;
  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  async metrics() {
    const mem = process.memoryUsage();
    const checks: Record<string, unknown> = {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
      },
      database: 'unknown',
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'connected';

      const [pendingPayouts, openFraudFlags, activeDevelopers] = await Promise.all([
        this.prisma.payoutRequest.count({ where: { status: { in: ['requested', 'under_review', 'approved', 'processing'] } } }),
        this.prisma.fraudFlag.count({ where: { status: 'open' } }),
        this.prisma.user.count({ where: { role: 'developer', status: 'active' } }),
      ]);
      checks['counts'] = {
        payoutsInFlight: pendingPayouts,
        openFraudFlags,
        activeDevelopers,
      };
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Metrics: database unreachable');
    }

    return checks;
  }
}