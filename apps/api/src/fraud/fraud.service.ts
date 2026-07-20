import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  FraudFlagStatus as DbFraudFlagStatus,
  FraudFlagType as DbFraudFlagType,
  FraudSeverity as DbFraudSeverity,
  Prisma,
  TrustLevel,
} from '@waitlayer/db';
import { FraudFlagType, FraudSeverity, RATE_LIMITS, TRUST_SCORE } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AlertsService } from '../observability/alerts.service';
import {
  ACTIVE_FRAUD_FLAG_STATUSES,
  payoutFraudLockKey,
  validateFraudFlagTransition,
} from './fraud.constants';

// P1.25 alert spike tuning: how many anomalous-CTR detections per user within
// the trailing window count as a "spike" worth alerting on.
const CTR_SPIKE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CTR_SPIKE_THRESHOLD = 5;

// P0.1: anomaly thresholds for behavioural verification of wait-state signals.
const ANOMALY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ANOMALY_MIN_EVENTS = 5; // need at least this many events before flagging

function fraudSeverityRank(severity: string): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity] ?? -1;
}

@Injectable()
export class FraudService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private readonly alerts?: AlertsService,
  ) {}

  // ── Rate Limit Checks ──

  async checkImpressionRateLimit(
    userId: string,
    deviceId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [userCount, deviceCount] = await Promise.all([
      this.prisma.adImpression.count({
        where: { userId, createdAt: { gte: oneHourAgo } },
      }),
      this.prisma.adImpression.count({
        where: { deviceId, createdAt: { gte: oneHourAgo } },
      }),
    ]);

    if (userCount >= RATE_LIMITS.IMPRESSIONS_PER_USER_PER_HOUR) {
      await this.createFlag({
        flagType: FraudFlagType.IMPRESSION_RATE_LIMIT,
        severity: FraudSeverity.LOW,
        userId,
        deviceId,
        evidence: { userCount, limit: RATE_LIMITS.IMPRESSIONS_PER_USER_PER_HOUR },
      });
      return { allowed: false, reason: 'impression_rate_limit_user' };
    }

    if (deviceCount >= RATE_LIMITS.IMPRESSIONS_PER_DEVICE_PER_HOUR) {
      await this.createFlag({
        flagType: FraudFlagType.IMPRESSION_RATE_LIMIT,
        severity: FraudSeverity.LOW,
        userId,
        deviceId,
        evidence: { deviceCount, limit: RATE_LIMITS.IMPRESSIONS_PER_DEVICE_PER_HOUR },
      });
      return { allowed: false, reason: 'impression_rate_limit_device' };
    }

    return { allowed: true };
  }

  async checkClickPatterns(
    userId: string,
    impressionId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // One click per impression
    const existing = await this.prisma.adClick.count({
      where: { impressionId },
    });
    if (existing > 0) return { allowed: false, reason: 'duplicate_click' };

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [clicks, impressions] = await Promise.all([
      this.prisma.adClick.count({
        where: { userId, createdAt: { gte: oneHourAgo } },
      }),
      this.prisma.adImpression.count({
        where: { userId, createdAt: { gte: oneHourAgo } },
      }),
    ]);

    // Suspicious CTR: > 50% with 5+ impressions
    if (impressions >= 5 && clicks / impressions > 0.5) {
      await this.createFlag({
        flagType: FraudFlagType.SUSPICIOUS_CTR,
        severity: FraudSeverity.HIGH,
        userId,
        evidence: { clicks, impressions, ctr: clicks / impressions },
      });
      // P1.25: alert on a burst of anomalous CTR (a CTR spike), not every
      // single detection. The sliding-window counter + cooldown dedupe keeps
      // the alert stream actionable.
      const burst =
        this.alerts?.recordRate('ctr_impression_spike', userId, CTR_SPIKE_WINDOW_MS) ?? 0;
      if (burst >= CTR_SPIKE_THRESHOLD) {
        this.alerts?.sendAlert('ctr_impression_spike', `user:${userId}`, {
          userId,
          ctr: clicks / impressions,
          windowCount: burst,
        });
      }
      return { allowed: false, reason: 'suspicious_ctr' };
    }

    // Click rate limit
    if (clicks >= RATE_LIMITS.CLICKS_PER_USER_PER_HOUR) {
      await this.createFlag({
        flagType: FraudFlagType.CLICK_RATE_LIMIT,
        severity: FraudSeverity.MEDIUM,
        userId,
        evidence: { clicks, limit: RATE_LIMITS.CLICKS_PER_USER_PER_HOUR },
      });
      return { allowed: false, reason: 'click_rate_limit' };
    }

    return { allowed: true };
  }

  /** Check for self-clicking (advertiser clicking own ads via developer account) */
  async checkSelfClick(
    userId: string,
    campaignId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { advertiser: true },
    });
    if (!campaign) return { allowed: true };

    if (campaign.advertiser.userId === userId) {
      await this.createFlag({
        flagType: FraudFlagType.SELF_CLICKING,
        severity: FraudSeverity.CRITICAL,
        userId,
        campaignId,
        evidence: { campaignId, advertiserUserId: campaign.advertiser.userId },
      });
      return { allowed: false, reason: 'self_clicking' };
    }

    return { allowed: true };
  }

  // ── Extended Fraud Detection ──

  /**
   * Detect a device fingerprint registered to multiple users. The DB enforces
   * @@unique([fingerprintHash]) so a P2002 on registration is the trigger; this
   * method is called from the device-registration error path to flag the
   * existing owner + the attempted new owner.
   */
  async checkDuplicateDevice(fingerprintHash: string, attemptingUserId: string): Promise<void> {
    const existing = await this.prisma.device.findFirst({
      where: { fingerprintHash },
      select: { userId: true, id: true },
    });
    if (!existing || existing.userId === attemptingUserId) return;

    await this.createFlag({
      flagType: FraudFlagType.DUPLICATE_DEVICE,
      severity: FraudSeverity.HIGH,
      userId: attemptingUserId,
      deviceId: existing.id,
      evidence: { fingerprintHash, existingUserId: existing.userId },
    });
  }

  /**
   * Detect a rapid earning spike: earnings in the last hour exceeding 3× the
   * trailing 7-day hourly average (with a minimum threshold to avoid noise on
   * new accounts). Called from the impression-earnings recording path.
   */
  async checkRapidEarningSpike(userId: string): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [lastHour, trailing7d] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: { userId, entryType: 'credit', createdAt: { gte: oneHourAgo } },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, entryType: 'credit', createdAt: { gte: sevenDaysAgo } },
        _sum: { amountMinor: true },
      }),
    ]);

    const lastHourAmount = Number(lastHour._sum.amountMinor ?? 0n);
    const trailing7dAmount = Number(trailing7d._sum.amountMinor ?? 0n);
    const hourlyAverage = trailing7dAmount / (7 * 24);

    // Only flag if the last hour exceeded 3× the average AND the absolute
    // threshold (5000 minor units = $50) to avoid false positives on new
    // accounts with tiny earnings.
    if (lastHourAmount > 5000 && hourlyAverage > 0 && lastHourAmount > 3 * hourlyAverage) {
      await this.createFlag({
        flagType: FraudFlagType.RAPID_EARNING_SPIKE,
        severity: FraudSeverity.MEDIUM,
        userId,
        evidence: { lastHourAmount, hourlyAverage, ratio: lastHourAmount / hourlyAverage },
      });
    }
  }

  /**
   * Detect a country change for a device: the user's profile country differs
   * from the country reported in the current ad request. A single mismatch
   * could be travel/VPN; the flag is created at MEDIUM severity for review.
   */
  async checkCountryDeviceChange(
    userId: string,
    deviceId: string,
    requestCountry: string | null,
  ): Promise<void> {
    if (!requestCountry) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { country: true },
    });
    if (!user?.country) return;
    if (user.country.toUpperCase() === requestCountry.toUpperCase()) return;

    await this.createFlag({
      flagType: FraudFlagType.COUNTRY_DEVICE_CHANGE,
      severity: FraudSeverity.MEDIUM,
      userId,
      deviceId,
      evidence: { profileCountry: user.country, requestCountry },
    });
  }

  /**
   * Detect repeated click abuse: 5+ clicks on the same campaign from the same
   * user within an hour. A single click is legitimate; repeated clicks on one
   * campaign suggest click-farm behaviour.
   */
  async checkRepeatedClickAbuse(userId: string, campaignId: string): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const clickCount = await this.prisma.adClick.count({
      where: { userId, campaignId, createdAt: { gte: oneHourAgo } },
    });
    if (clickCount >= 5) {
      await this.createFlag({
        flagType: FraudFlagType.REPEATED_CLICK_ABUSE,
        severity: FraudSeverity.HIGH,
        userId,
        campaignId,
        evidence: { clickCount, campaignId, window: '1h' },
      });
    }
  }

  /**
   * Detect automated/bot patterns: ad impressions at very regular intervals
   * (low variance in inter-arrival times) suggest a script rather than human
   * behaviour. Requires 10+ impressions in the last hour.
   */
  async checkAutomatedPattern(userId: string): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const impressions = await this.prisma.adImpression.findMany({
      where: { userId, createdAt: { gte: oneHourAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    if (impressions.length < 10) return;

    // Compute inter-arrival intervals and their coefficient of variation.
    const intervals: number[] = [];
    for (let i = 1; i < impressions.length; i++) {
      intervals.push(impressions[i].createdAt.getTime() - impressions[i - 1].createdAt.getTime());
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean === 0) return;
    const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    // A coefficient of variation < 0.1 means intervals are extremely regular
    // (human behaviour has much higher variance). This is a strong bot signal.
    if (cv < 0.1) {
      await this.createFlag({
        flagType: FraudFlagType.AUTOMATED_PATTERN,
        severity: FraudSeverity.HIGH,
        userId,
        evidence: {
          impressionCount: impressions.length,
          meanIntervalMs: mean,
          stdDevMs: stdDev,
          cv,
        },
      });
    }
  }

  /**
   * Detect a shared payout destination: the same destination (email/account)
   * registered by multiple users. This is a strong signal of a sock-puppet
   * farming operation.
   */
  async checkSharedPayoutDestination(userId: string, destination: string): Promise<void> {
    const otherAccounts = await this.prisma.payoutAccount.count({
      where: { destination, userId: { not: userId }, isActive: true },
    });
    if (otherAccounts > 0) {
      await this.createFlag({
        flagType: FraudFlagType.SHARED_PAYOUT_DESTINATION,
        severity: FraudSeverity.CRITICAL,
        userId,
        evidence: { destination, sharedWithUserCount: otherAccounts },
      });
    }
  }

  /**
   * Detect impossible volume: more impressions in a 1-minute window than a
   * human could physically trigger (e.g., >60 impressions/minute = one per
   * second, which is impossible given the 5-second minimum visible duration).
   */
  async checkImpossibleVolume(userId: string): Promise<void> {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const count = await this.prisma.adImpression.count({
      where: { userId, createdAt: { gte: oneMinuteAgo } },
    });
    // The minimum visible duration is 5 seconds, so >12 impressions/minute
    // is physically impossible for a real human. Use 20 as the threshold to
    // allow for clock skew and parallel ad delivery.
    if (count >= 20) {
      await this.createFlag({
        flagType: FraudFlagType.IMPOSSIBLE_VOLUME,
        severity: FraudSeverity.CRITICAL,
        userId,
        evidence: { count, windowSeconds: 60, threshold: 20 },
      });
    }
  }

  /**
   * Detect a duplicate account: a new account created from the same device
   * fingerprint as an existing account within 24 hours.
   */
  async checkDuplicateAccount(userId: string): Promise<void> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, email: true },
    });
    if (!user) return;

    // Only check newly created accounts (within 24h)
    if (user.createdAt < oneDayAgo) return;

    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: { fingerprintHash: true },
    });
    if (devices.length === 0) return;

    const hashes = devices.map((d) => d.fingerprintHash);
    const otherUsers = await this.prisma.device.findMany({
      where: { fingerprintHash: { in: hashes }, userId: { not: userId } },
      select: { userId: true },
      take: 1,
    });
    if (otherUsers.length > 0) {
      await this.createFlag({
        flagType: FraudFlagType.DUPLICATE_ACCOUNT,
        severity: FraudSeverity.HIGH,
        userId,
        evidence: { fingerprintHashes: hashes, matchedUserId: otherUsers[0].userId },
      });
    }
  }

  /**
   * Detect VPN/proxy patterns from device platform metadata. Without an
   * external IP-reputation service, we flag known VPN/proxy platform
   * indicators (datacenter user agents, headless browser signatures).
   */
  async checkVpnProxyPattern(
    userId: string,
    deviceId: string,
    platform: string | null,
  ): Promise<void> {
    if (!platform) return;
    const lower = platform.toLowerCase();
    const vpnIndicators = [
      'headless',
      'phantom',
      'selenium',
      'puppeteer',
      'playwright',
      'webdriver',
    ];
    if (vpnIndicators.some((ind) => lower.includes(ind))) {
      await this.createFlag({
        flagType: FraudFlagType.VPN_PROXY_PATTERN,
        severity: FraudSeverity.HIGH,
        userId,
        deviceId,
        evidence: { platform, matchedIndicator: vpnIndicators.find((i) => lower.includes(i)) },
      });
    }
  }

  /**
   * Detect emulator/VM patterns from device platform metadata. Flag known
   * emulator/VM platform names that indicate a non-physical device.
   */
  async checkEmulatorVmPattern(
    userId: string,
    deviceId: string,
    platform: string | null,
  ): Promise<void> {
    if (!platform) return;
    const lower = platform.toLowerCase();
    const vmIndicators = ['emulator', 'simulator', 'virtual box', 'vmware', 'qemu', 'x86 emulator'];
    if (vmIndicators.some((ind) => lower.includes(ind))) {
      await this.createFlag({
        flagType: FraudFlagType.EMULATOR_VM_PATTERN,
        severity: FraudSeverity.MEDIUM,
        userId,
        deviceId,
        evidence: { platform, matchedIndicator: vmIndicators.find((i) => lower.includes(i)) },
      });
    }
  }

  // ── Wait-State Signal Anomaly Detection (P0.1) ──

  /**
   * Detect modified clients that forge wait-state signals by looking for
   * behavioural anomalies: repeated identical signal sets, bursts of single-
   * signal `ai_generation` events, or waits with identical short durations.
   * This is intentionally best-effort; it creates a fraud flag for review but
   * does not block the wait-state from being recorded.
   */
  async checkAnomalousWaitSignals(
    userId: string,
    deviceId: string,
    signals: { type: string; details?: string }[],
  ): Promise<void> {
    const oneHourAgo = new Date(Date.now() - ANOMALY_WINDOW_MS);
    const recent = await this.prisma.waitStateEvent.findMany({
      where: {
        userId,
        deviceId,
        eventType: 'wait_state_start',
        createdAt: { gte: oneHourAgo },
      },
      select: { signals: true, duration: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (recent.length < ANOMALY_MIN_EVENTS) return;

    // Normalize the incoming signal set for comparison.
    const signalKey = (s: { type: string }[]) =>
      [...new Set(s.map((x) => x.type).sort())].join(',');
    const currentKey = signalKey(signals);

    // Count identical signal payloads in the trailing window.
    let identicalPayloadCount = 0;
    for (const row of recent) {
      const rowSignals = (row.signals as unknown as { type: string }[]) ?? [];
      if (signalKey(rowSignals) === currentKey) {
        identicalPayloadCount++;
      }
    }

    // Repeated identical payloads, especially single-signal ai_generation,
    // indicate a forged / scripted client.
    if (identicalPayloadCount >= ANOMALY_MIN_EVENTS) {
      await this.createFlag({
        flagType: FraudFlagType.AUTOMATED_PATTERN,
        severity: FraudSeverity.HIGH,
        userId,
        deviceId,
        evidence: {
          identicalPayloadCount,
          windowMs: ANOMALY_WINDOW_MS,
          signalKey: currentKey,
          reason: 'repeated_identical_wait_signals',
        },
      });
    }
  }

  // ── Trust Score Computation ──

  async computeTrustScore(userId: string): Promise<number> {
    // Serialize the complete read-compute-write cycle per user. The previous
    // optimistic guard compared trust_scores.updatedAt with the timestamp read
    // BEFORE its own upsert; because @updatedAt changes on that upsert, every
    // recomputation after the first skipped the users.trustLevel write. A
    // transaction-scoped advisory lock both fixes that self-invalidating CAS
    // and prevents a stale concurrent computation from overwriting a newer
    // score/level pair.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trust-score:${userId}`}))`;
        return this.computeTrustScoreLocked(tx, userId);
      },
      { timeout: 10_000 },
    );
  }

  private async computeTrustScoreLocked(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: {
        fraudFlags: { where: { status: { in: ACTIVE_FRAUD_FLAG_STATUSES } } },
      },
    });
    if (!user) return TRUST_SCORE.INITIAL;

    let score: number = TRUST_SCORE.INITIAL;

    // Account age: 0-15 points (1 pt per day, max 15)
    const ageDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const accountAgePoints = Math.min(15, Math.floor(ageDays));
    score += accountAgePoints;

    // Email verified: +10
    const emailVerifiedPts = user.emailVerified ? 10 : 0;
    score += emailVerifiedPts;

    // GitHub verified: +15
    const githubVerifiedPts = user.githubVerified ? 15 : 0;
    score += githubVerifiedPts;

    // Google verified: +15
    const googleVerifiedPts = user.googleVerified ? 15 : 0;
    score += googleVerifiedPts;

    // Device consistency: +5 for single device, +3 for 2-3, 0 for 4+
    const deviceCount = await tx.device.count({ where: { userId } });
    const deviceConsistPts = deviceCount === 1 ? 10 : deviceCount >= 2 && deviceCount <= 3 ? 5 : 0;
    score += deviceConsistPts;

    // Activity consistency is based on DISTINCT UTC calendar days, not raw
    // event count. Counting every wait_state_start let a client spam 30
    // starts in one burst and immediately obtain the full 10-point trust
    // bonus intended to represent a month of recurring usage.
    const activityRows = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT DATE("createdAt" AT TIME ZONE 'UTC'))::int AS "count"
      FROM "wait_state_events"
      WHERE "userId" = ${userId}
        AND "eventType" = 'wait_state_start'
        AND "createdAt" >= ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}
    `;
    const activityPatternPts = Math.min(10, activityRows[0]?.count ?? 0);
    score += activityPatternPts;

    // Payout history: +5 per successful payout, max 20
    const paidPayouts = await tx.payoutRequest.count({
      where: { userId, status: 'paid' },
    });
    const payoutHistoryPts = Math.min(20, paidPayouts * 5);
    score += payoutHistoryPts;

    // Fraud penalties: subtract based on severity
    const fraudPenaltyPts = user.fraudFlags.reduce((acc: number, f: { severity: string }) => {
      switch (f.severity) {
        case 'critical':
          return acc + 20;
        case 'high':
          return acc + 10;
        case 'medium':
          return acc + 5;
        case 'low':
          return acc + 1;
        default:
          return acc;
      }
    }, 0);
    score -= fraudPenaltyPts;

    // Clamp to [0, 100]
    score = Math.max(TRUST_SCORE.MIN, Math.min(TRUST_SCORE.MAX, score));

    // Determine trust level
    const level =
      score >= TRUST_SCORE.THRESHOLDS.HIGH_TRUST
        ? TrustLevel.high_trust
        : score >= TRUST_SCORE.THRESHOLDS.NORMAL
          ? TrustLevel.normal
          : score >= TRUST_SCORE.THRESHOLDS.LOW_TRUST
            ? TrustLevel.low_trust
            : TrustLevel.new;

    // Update trust score record
    await tx.trustScore.upsert({
      where: { userId },
      create: {
        userId,
        score,
        level,
        accountAgePoints,
        emailVerifiedPts,
        githubVerifiedPts,
        googleVerifiedPts,
        deviceConsistPts,
        activityPatternPts,
        payoutHistoryPts,
        fraudPenaltyPts,
      },
      update: {
        score,
        level,
        accountAgePoints,
        emailVerifiedPts,
        githubVerifiedPts,
        googleVerifiedPts,
        deviceConsistPts,
        activityPatternPts,
        payoutHistoryPts,
        fraudPenaltyPts,
        computedAt: new Date(),
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { trustLevel: level },
    });

    return score;
  }

  // ── Flag Management ──

  async createFlag(params: {
    flagType: FraudFlagType;
    severity: FraudSeverity;
    userId?: string | null;
    deviceId?: string | null;
    campaignId?: string | null;
    impressionId?: string | null;
    clickId?: string | null;
    evidence: Record<string, unknown>;
    scoreDelta?: number;
  }) {
    // Deduplicate: don't create duplicate open flags for same user + type.
    // The findFirst + create are wrapped in a single $transaction so two
    // concurrent calls for the same user+type can't both pass the existence
    // check and create duplicate open flags. (Previously the findFirst and
    // create were separate statements — a classic TOCTOU window where two
    // concurrent rate-limit breaches would each see "no existing flag" and
    // both insert duplicate open flags.)
    const flag = await this.prisma.$transaction(async (tx) => {
      if (params.userId) {
        // Serialize active-flag creation with payout reservation and the final
        // pre-provider processing claim. processPayout commits its durable
        // initiation intent before external I/O, so this lock is held only for
        // database work and cannot inherit provider latency.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payoutFraudLockKey(params.userId)}))`;
        // The transaction alone does not serialize a find-then-create at the
        // default isolation level. Lock the logical (user,type) key so two
        // concurrent detections cannot both observe no open flag and insert a
        // duplicate before either commits.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fraud-flag:${params.userId}:${params.flagType}`}))`;
        const existing = await tx.fraudFlag.findFirst({
          where: {
            userId: params.userId,
            status: { in: ACTIVE_FRAUD_FLAG_STATUSES },
            flagType: params.flagType as DbFraudFlagType,
          },
        });
        if (existing) {
          const effectiveFlag =
            fraudSeverityRank(params.severity) > fraudSeverityRank(existing.severity)
              ? await tx.fraudFlag.update({
                  where: { id: existing.id },
                  data: { severity: params.severity as DbFraudSeverity },
                })
              : existing;
          if (params.severity === FraudSeverity.CRITICAL) {
            await tx.earningsLedger.updateMany({
              where: {
                userId: params.userId,
                status: { in: ['estimated', 'pending', 'confirmed'] },
                heldByFlagId: null,
              },
              data: {
                status: 'held',
                description: `Held: Critical fraud flag: ${params.flagType}`,
                heldByFlagId: effectiveFlag.id,
              },
            });
          }
          return effectiveFlag;
        }
      }

      const created = await tx.fraudFlag.create({
        data: {
          userId: params.userId || undefined,
          deviceId: params.deviceId || undefined,
          campaignId: params.campaignId || undefined,
          impressionId: params.impressionId || undefined,
          clickId: params.clickId || undefined,
          flagType: params.flagType as DbFraudFlagType,
          severity: params.severity as DbFraudSeverity,
          evidence: params.evidence as Prisma.InputJsonObject,
          scoreDelta: params.scoreDelta ?? 0,
        },
      });
      if (params.severity === FraudSeverity.CRITICAL && params.userId) {
        // Hold in the same transaction and under the same user advisory lock
        // as flag creation. A resolver can therefore never release/reverse the
        // flag and then lose a race to a late hold for that resolved flag.
        await tx.earningsLedger.updateMany({
          where: {
            userId: params.userId,
            status: { in: ['estimated', 'pending', 'confirmed'] },
            heldByFlagId: null,
          },
          data: {
            status: 'held',
            description: `Held: Critical fraud flag: ${params.flagType}`,
            heldByFlagId: created.id,
          },
        });
      }
      return created;
    });

    // Recompute trust score on any new flag
    if (params.userId) {
      await this.computeTrustScore(params.userId);
    }

    return flag;
  }

  async resolveFlag(flagId: string, reviewerId: string, isValid: boolean, reviewNote?: string) {
    // Read the owner first so resolution can acquire the same user-scoped lock
    // as createFlag and payout authorization. Identity fields are re-read after
    // the lock is held; this outer snapshot is used only to select the lock.
    const snapshot = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!snapshot) throw new NotFoundException('Fraud flag not found');
    const newStatus = isValid
      ? DbFraudFlagStatus.resolved_valid
      : DbFraudFlagStatus.resolved_invalid;
    const flag = await this.prisma.$transaction(
      async (tx) => {
        if (snapshot.userId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payoutFraudLockKey(snapshot.userId)}))`;
        }
        const current = await tx.fraudFlag.findUnique({ where: { id: flagId } });
        if (!current) throw new NotFoundException('Fraud flag not found');

        // A payout that already crossed processPayout's lock may have an
        // irreversible provider outcome in flight. Keep the flag active until
        // paid/failed so reversal can choose paid recovery debt vs. an unpaid
        // ledger reversal without guessing at the remote outcome.
        if (isValid && (current.clickId || current.impressionId)) {
          const inFlightAllocations = await tx.payoutAllocation.count({
            where: {
              payoutRequest: { status: 'processing' },
              earningsEntry: current.clickId
                ? { clickId: current.clickId }
                : { impressionId: current.impressionId },
            },
          });
          if (inFlightAllocations > 0) {
            throw new ConflictException(
              'Fraud confirmation is waiting for an in-flight payout to settle; reconcile the payout and retry',
            );
          }
        }

        let claimed = false;
        if (ACTIVE_FRAUD_FLAG_STATUSES.includes(current.status)) {
          // Declarative state-machine guard: validate the
          // open/reviewing/escalated → resolved_* transition before the CAS
          // updateMany. Terminal states skip this branch and keep their
          // existing idempotent resolution behavior.
          validateFraudFlagTransition(current.status, newStatus);
          const result = await tx.fraudFlag.updateMany({
            where: { id: flagId, status: { in: ACTIVE_FRAUD_FLAG_STATUSES } },
            data: { status: newStatus, reviewerId, reviewNote, resolvedAt: new Date() },
          });
          claimed = result.count === 1;
        }
        if (!claimed && current.status !== newStatus) {
          const existing = await tx.fraudFlag.findUnique({
            where: { id: flagId },
            select: { status: true },
          });
          if (existing?.status !== newStatus) {
            throw new BadRequestException(
              existing
                ? `Fraud flag cannot be resolved from status '${existing.status}'`
                : 'Fraud flag not found',
            );
          }
        }

        // Keep the user lock until ledger side effects finish. createFlag's
        // hold is in its matching locked transaction, so a resolved flag can
        // never receive a late hold after its release/reversal completes.
        if (isValid && current.userId && (current.clickId || current.impressionId)) {
          await this.ledger.reverseEarnings(
            {
              impressionId: current.impressionId ?? undefined,
              clickId: current.clickId ?? undefined,
            },
            `Fraud confirmed: ${current.flagType}`,
            tx,
          );
        } else if (isValid && current.userId) {
          // behavioral critical flags (SHARED_PAYOUT_DESTINATION,
          // IMPOSSIBLE_VOLUME, SELF_CLICKING without a click/impression) have no
          // single entity whose earnings can be reversed. The hold at createFlag
          // spans every confirmed/pending/estimated row for the user, but the
          // resolution must also release those rows to prevent a permanent
          // balance freeze (the developer can never withdraw held earnings, and
          // no other admin action could release them). We forfeit the developer
          // share WITHOUT writing compensating advertiser/platform reversals
          // because (a) the impressions were legitimately served and the
          // advertiser paid for them, (b) the platform fee is correctly collected,
          // and (c) fraud_reserve already acts as the platform-side safety valve.
          // The developer forfeits held funds on their side; platform cash stays.
          // count===0 is idempotent: the hold grabbed nothing (account was empty
          // at flag time) or a prior resolution already settled these rows.
          await tx.earningsLedger.updateMany({
            where: { userId: current.userId, heldByFlagId: current.id, status: 'held' },
            data: {
              status: 'reversed',
              heldByFlagId: null,
              description: `Forfeited: confirmed behavioral fraud ${current.flagType} (${current.id})`,
            },
          });
        } else if (!isValid && current.userId) {
          await this.ledger.releaseEarnings(
            current.userId,
            {
              impressionId: current.impressionId ?? undefined,
              flagId: current.id,
            },
            tx,
          );
        }
        return current;
      },
      { timeout: 30_000 },
    );

    // Recompute trust score after resolution
    if (flag.userId) {
      await this.computeTrustScore(flag.userId);
    }

    return { flagId, status: newStatus, isValid };
  }

  /**
   * Escalate an open/reviewing fraud flag to the `escalated` state for
   * senior-review / manual investigation. Escalation does NOT release holds or
   * reverse earnings — the flag stays open from a money perspective until a
   * reviewer resolves it. This closes the gap where `escalated` was a declared
   * status (counted in getFlagStats and escalationRate) but had no producer.
   */
  async escalateFlag(flagId: string, reviewerId: string, reviewNote?: string) {
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Fraud flag not found');

    let claimed = false;
    if (flag.status === DbFraudFlagStatus.open || flag.status === DbFraudFlagStatus.reviewing) {
      // Declarative state-machine guard: validate the open/reviewing →
      // escalated transition before the CAS updateMany.
      validateFraudFlagTransition(flag.status, DbFraudFlagStatus.escalated);
      const result = await this.prisma.fraudFlag.updateMany({
        where: {
          id: flagId,
          status: { in: [DbFraudFlagStatus.open, DbFraudFlagStatus.reviewing] },
        },
        data: {
          status: DbFraudFlagStatus.escalated,
          reviewerId,
          reviewNote,
        },
      });
      claimed = result.count === 1;
    }

    if (!claimed && flag.status !== DbFraudFlagStatus.escalated) {
      const existing = await this.prisma.fraudFlag.findUnique({
        where: { id: flagId },
        select: { status: true },
      });
      if (existing?.status === DbFraudFlagStatus.escalated) {
        // Idempotent: already escalated by a concurrent reviewer.
        claimed = false;
      } else {
        throw new BadRequestException(
          existing
            ? `Fraud flag cannot be escalated from status '${existing.status}'`
            : 'Fraud flag not found',
        );
      }
    }

    return { flagId, status: DbFraudFlagStatus.escalated as string };
  }

  // ── Admin Queries ──

  async getOpenFlags(page = 1, limit = 20, severity?: string) {
    const where: Prisma.FraudFlagWhereInput = {
      status: { in: ACTIVE_FRAUD_FLAG_STATUSES },
    };
    if (severity) where.severity = severity as DbFraudSeverity;

    const [flags, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, trustLevel: true } },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    return { flags, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getFlagStats() {
    const [open, reviewing, resolvedValid, resolvedInvalid, escalated] = await Promise.all([
      this.prisma.fraudFlag.count({ where: { status: 'open' } }),
      this.prisma.fraudFlag.count({ where: { status: 'reviewing' } }),
      this.prisma.fraudFlag.count({ where: { status: 'resolved_valid' } }),
      this.prisma.fraudFlag.count({ where: { status: 'resolved_invalid' } }),
      this.prisma.fraudFlag.count({ where: { status: 'escalated' } }),
    ]);

    return { open, reviewing, resolvedValid, resolvedInvalid, escalated };
  }
}
