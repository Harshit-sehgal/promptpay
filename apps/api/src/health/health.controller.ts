import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../config/prisma.service';
import { MINIMUM_WAIT_CONFIDENCE } from '../extension/extension.constants';
import { RedisHealthService } from './redis-health.service';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  private static readonly DATABASE_PROBE_TIMEOUT_MS = 2_000;
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisHealthService,
  ) {}

  @ApiOperation({ summary: 'Health check' })
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
      await this.checkDatabase();
      checks['database'] = 'connected';
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Health check: database unreachable');
    }

    // Redis connectivity check (abuse controls / rate limiting backing store)
    const redis = await this.redis.check();
    checks['redis'] = redis;

    return checks;
  }

  /**
   * Readiness probe — used by Docker/K8s healthchecks and load balancers.
   *
   * Unlike `GET /health` (liveness, which always returns HTTP 200 so a
   * crashed process can be detected and restarted), readiness returns a
   * non-200 status when a required dependency (Postgres, Redis) is
   * unavailable. This prevents routing traffic to an API that cannot safely
   * serve it (A-042).
   */
  @ApiOperation({ summary: 'Readiness check' })
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const checks: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
    let ready = true;

    try {
      await this.checkDatabase();
      checks['database'] = 'connected';
    } catch {
      ready = false;
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Readiness: database unreachable');
    }

    const redis = await this.redis.check();
    checks['redis'] = redis;
    if (redis.status !== 'connected') {
      ready = false;
    }

    if (!ready) {
      throw new HttpException(checks, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return checks;
  }

  @ApiOperation({ summary: 'Get health metrics' })
  @Get('metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
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
      await this.checkDatabase();
      checks['database'] = 'connected';

      const redis = await this.redis.check();
      checks['redis'] = redis;

      const [
        pendingPayouts,
        openFraudFlags,
        activeDevelopers,
        emailQueueDepth,
        webhookStalled,
        webhookLagSeconds,
        overspendAttempts,
        waitPrecision,
      ] = await Promise.all([
        this.prisma.payoutRequest.count({
          where: { status: { in: ['requested', 'under_review', 'approved', 'processing'] } },
        }),
        this.prisma.fraudFlag.count({ where: { status: 'open' } }),
        this.prisma.user.count({ where: { role: 'developer', status: 'active' } }),
        // Email queue depth: pending retries awaiting processing
        this.prisma.emailQueue.count({
          where: { nextRetryAt: { lte: new Date() } },
        }),
        // Webhook events stuck in 'processing' beyond the 30-minute timeout
        this.prisma.webhookEvent.count({
          where: {
            processingStatus: 'processing',
            processedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
          },
        }),
        // Webhook lag: age of the oldest unprocessed webhook event (seconds)
        this.computeWebhookLagSeconds(),
        // Overspend attempts: impressions invalidated due to budget exhaustion
        this.prisma.adImpression.count({
          where: { invalidationReason: 'budget_exhausted' },
        }),
        // Wait-detection quality: precision and false-positive rate
        this.computeWaitDetectionQuality(),
      ]);
      checks['counts'] = {
        payoutsInFlight: pendingPayouts,
        openFraudFlags,
        activeDevelopers,
      };
      // Production monitoring for queue depth, webhook lag, overspend attempts,
      // and wait-detection quality (mandatory priority: production monitoring).
      checks['queues'] = {
        emailQueueDepth,
        webhookStalled,
        webhookLagSeconds,
      };
      checks['financial'] = {
        overspendAttempts,
      };
      checks['waitDetection'] = waitPrecision;
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Metrics: database unreachable');
    }

    return checks;
  }

  /**
   * Compute the age of the oldest unprocessed webhook event in seconds.
   * Returns 0 when no pending/processing events exist.
   */
  private async computeWebhookLagSeconds(): Promise<number> {
    const oldest = await this.prisma.webhookEvent.findFirst({
      where: { processingStatus: { in: ['pending', 'processing'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (!oldest) return 0;
    return Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000);
  }

  /**
   * Compute wait-detection quality metrics: precision (confirmed billable
   * impressions from high-confidence waits / all billable impressions) and
   * the false-positive rate (flagged wait states / all wait states).
   * Only the last 7 days are considered so the signal reflects current
   * detector behaviour, not historical data.
   */
  private async computeWaitDetectionQuality(): Promise<{
    precision: number;
    falsePositiveRate: number;
    totalWaitStates: number;
    flaggedFalsePositives: number;
    lowConfidenceBlocked: number;
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalWaitStates, flaggedFalsePositives, lowConfidenceBlocked] = await Promise.all([
      this.prisma.waitStateEvent.count({
        where: { eventType: 'wait_state_start', createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.waitStateEvent.count({
        where: {
          eventType: 'wait_state_start',
          isFalsePositive: true,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      // Low-confidence wait states blocked from billing (confidence below
      // threshold or null) — the detector's safety floor.
      this.prisma.waitStateEvent.count({
        where: {
          eventType: 'wait_state_start',
          createdAt: { gte: sevenDaysAgo },
          OR: [{ confidence: null }, { confidence: { lt: MINIMUM_WAIT_CONFIDENCE } }],
        },
      }),
    ]);
    const falsePositiveRate = totalWaitStates > 0 ? flaggedFalsePositives / totalWaitStates : 0;
    // Precision: high-confidence wait states that were NOT flagged as false
    // positive / all high-confidence wait states. Low-confidence events are
    // already blocked from billing, so precision is measured on the billable
    // population only.
    const highConfidenceTotal = totalWaitStates - lowConfidenceBlocked;
    const highConfidenceTruePositives = highConfidenceTotal - flaggedFalsePositives;
    const precision =
      highConfidenceTotal > 0 ? highConfidenceTruePositives / highConfidenceTotal : 1;
    return {
      precision,
      falsePositiveRate,
      totalWaitStates,
      flaggedFalsePositives,
      lowConfidenceBlocked,
    };
  }

  private async checkDatabase(): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Bound both server execution and Prisma pool acquisition. A plain
        // SELECT 1 can otherwise hang readiness indefinitely when Postgres is
        // reachable at the socket layer but saturated/unresponsive.
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
        await tx.$queryRaw`SELECT 1`;
      },
      {
        maxWait: HealthController.DATABASE_PROBE_TIMEOUT_MS,
        timeout: HealthController.DATABASE_PROBE_TIMEOUT_MS + 500,
      },
    );
  }
}
