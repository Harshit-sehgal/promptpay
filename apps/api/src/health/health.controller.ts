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
import { MINIMUM_WAIT_CONFIDENCE, SIGNAL_WEIGHTS } from '../extension/extension.constants';
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

      // Money-discrepancy monitoring: compare per-currency ledger totals to
      // detect accounting drift before it compounds.
      // Provider-failure monitoring: count failed payout transactions per
      // provider over the last 24 hours so ops can spot degraded rails.
      const [ledgerDiscrepancies, providerFailures] = await Promise.all([
        this.safeCompute('ledgerDiscrepancies', () => this.computeLedgerDiscrepancies()),
        this.safeCompute('providerFailures', () => this.computeProviderFailures()),
      ]);
      checks['ledgerDiscrepancies'] = ledgerDiscrepancies;
      checks['providerFailures'] = providerFailures;
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Metrics: database unreachable');
    }

    return checks;
  }

  /**
   * Run a metrics computation and return a structured error if it fails,
   * so one failing metric does not swallow the entire /health/metrics response.
   */
  private async safeCompute<T>(
    name: string,
    compute: () => Promise<T>,
  ): Promise<T | { error: string }> {
    try {
      return await compute();
    } catch (err) {
      this.logger.error(
        `Metrics: ${name} computation failed: ${err instanceof Error ? err.message : err}`,
      );
      return { error: 'computation_failed' };
    }
  }

  /**
   * Compute per-currency ledger discrepancies by comparing advertiser spend
   * against the sum of developer earnings, platform fees, and fraud reserves.
   * A non-zero discrepancy indicates accounting drift that should be investigated.
   */
  private async computeLedgerDiscrepancies(): Promise<{
    discrepancies: Array<{
      currency: string;
      netAdvertiserSpendMinor: string;
      netEarningsMinor: string;
      netPlatformFeeMinor: string;
      netReserveMinor: string;
      discrepancyMinor: string;
    }>;
    hasDiscrepancy: boolean;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        currency: string;
        netAdvertiserSpendMinor: bigint;
        netEarningsMinor: bigint;
        netPlatformFeeMinor: bigint;
        netReserveMinor: bigint;
        discrepancyMinor: bigint;
      }>
    >`
      WITH advertiser_spend AS (
        SELECT
          "currency",
          SUM(
            CASE
              WHEN "entryType" = 'debit' AND "status" IN ('confirmed', 'paid') THEN "amountMinor"
              WHEN "entryType" IN ('refund', 'reversal') AND "status" IN ('confirmed', 'paid') THEN -"amountMinor"
              ELSE 0
            END
          )::bigint AS amount
        FROM "advertiser_ledger"
        GROUP BY "currency"
      ),
      earnings AS (
        SELECT
          "currency",
          SUM(
            CASE
              WHEN "entryType" = 'credit' AND "status" IN ('estimated', 'pending', 'confirmed', 'held', 'paid') THEN "amountMinor"
              WHEN "entryType" = 'debit' AND "status" = 'confirmed' THEN -"amountMinor"
              ELSE 0
            END
          )::bigint AS amount
        FROM "earnings_ledger"
        GROUP BY "currency"
      ),
      platform_fee AS (
        SELECT
          "currency",
          SUM(
            CASE
              WHEN "entryType" = 'credit' AND "bucket" = 'platform_fee' AND "status" = 'confirmed' THEN "amountMinor"
              WHEN "entryType" = 'reversal' AND "bucket" = 'platform_fee' AND "status" = 'confirmed' THEN -"amountMinor"
              ELSE 0
            END
          )::bigint AS amount
        FROM "platform_ledger"
        GROUP BY "currency"
      ),
      fraud_reserve AS (
        SELECT
          "currency",
          SUM(
            CASE
              WHEN "entryType" = 'credit' AND "bucket" = 'fraud_reserve' AND "status" = 'confirmed' THEN "amountMinor"
              WHEN "entryType" = 'reversal' AND "bucket" = 'fraud_reserve' AND "status" = 'confirmed' THEN -"amountMinor"
              ELSE 0
            END
          )::bigint AS amount
        FROM "platform_ledger"
        GROUP BY "currency"
      )
      SELECT
        COALESCE(a."currency", e."currency", pf."currency", fr."currency") AS "currency",
        COALESCE(a.amount, 0)::bigint AS "netAdvertiserSpendMinor",
        COALESCE(e.amount, 0)::bigint AS "netEarningsMinor",
        COALESCE(pf.amount, 0)::bigint AS "netPlatformFeeMinor",
        COALESCE(fr.amount, 0)::bigint AS "netReserveMinor",
        (COALESCE(a.amount, 0) - (COALESCE(e.amount, 0) + COALESCE(pf.amount, 0) + COALESCE(fr.amount, 0)))::bigint AS "discrepancyMinor"
      FROM advertiser_spend a
      FULL OUTER JOIN earnings e ON a."currency" = e."currency"
      FULL OUTER JOIN platform_fee pf ON a."currency" = pf."currency"
      FULL OUTER JOIN fraud_reserve fr ON a."currency" = fr."currency"
      ORDER BY "currency" ASC
    `;

    const discrepancies = rows.map((row) => ({
      currency: row.currency,
      netAdvertiserSpendMinor: row.netAdvertiserSpendMinor.toString(),
      netEarningsMinor: row.netEarningsMinor.toString(),
      netPlatformFeeMinor: row.netPlatformFeeMinor.toString(),
      netReserveMinor: row.netReserveMinor.toString(),
      discrepancyMinor: row.discrepancyMinor.toString(),
    }));

    return {
      discrepancies,
      hasDiscrepancy: discrepancies.some((d) => BigInt(d.discrepancyMinor) !== 0n),
    };
  }

  /**
   * Compute the number of failed payout transactions per provider within the
   * last 24 hours. A transaction is considered a failure if its status is
   * `failed` or a failure reason was recorded. Returns both a per-provider
   * breakdown and an aggregate total for easy alerting.
   */
  private async computeProviderFailures(): Promise<{
    byProvider: Record<string, number>;
    total: number;
  }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.payoutTransaction.groupBy({
      by: ['provider'],
      where: {
        updatedAt: { gte: twentyFourHoursAgo },
        OR: [{ status: 'failed' }, { failureReason: { not: null } }],
      },
      _count: { id: true },
    });

    const byProvider = Object.fromEntries(rows.map((row) => [row.provider, row._count.id]));
    const total = rows.reduce((sum, row) => sum + row._count.id, 0);
    return { byProvider, total };
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
    falsePositivesBySignal: Array<{ signal: string; count: number; rate: number }>;
    signalWeightRecommendations: Array<{
      signal: string;
      currentWeight: number;
      recommendedAction: string;
    }>;
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalWaitStates, flaggedFalsePositives, lowConfidenceBlocked, fpBySignalRows] =
      await Promise.all([
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
        // Per-signal-type false-positive breakdown: group flagged FPs by the
        // `reason` field (which stores the dominant signal type). This makes
        // the isFalsePositive feedback actionable — operators can see which
        // signal types produce the most FPs and tune weights accordingly.
        this.prisma.waitStateEvent.groupBy({
          by: ['reason'],
          where: {
            eventType: 'wait_state_start',
            isFalsePositive: true,
            createdAt: { gte: sevenDaysAgo },
          },
          _count: { _all: true },
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

    // Build per-signal FP breakdown
    const falsePositivesBySignal = fpBySignalRows.map((row) => ({
      signal: row.reason ?? 'unknown',
      count: row._count._all,
      rate: highConfidenceTotal > 0 ? row._count._all / highConfidenceTotal : 0,
    }));

    // Generate weight-tuning recommendations: if a signal type's FP rate
    // exceeds 5%, recommend lowering its weight. This is the feedback
    // consumption mechanism — the isFalsePositive data drives concrete
    // tuning guidance rather than being write-only telemetry.
    const signalWeightRecommendations: Array<{
      signal: string;
      currentWeight: number;
      recommendedAction: string;
    }> = [];
    for (const fp of falsePositivesBySignal) {
      const weight = SIGNAL_WEIGHTS[fp.signal];
      if (weight !== undefined && fp.rate > 0.05) {
        signalWeightRecommendations.push({
          signal: fp.signal,
          currentWeight: weight,
          recommendedAction: `FP rate ${(fp.rate * 100).toFixed(1)}% exceeds 5% threshold — consider lowering weight below ${MINIMUM_WAIT_CONFIDENCE} or adding required co-signals.`,
        });
      }
    }

    return {
      precision,
      falsePositiveRate,
      totalWaitStates,
      flaggedFalsePositives,
      lowConfidenceBlocked,
      falsePositivesBySignal,
      signalWeightRecommendations,
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
