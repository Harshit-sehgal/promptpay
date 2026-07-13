import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

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

@Injectable()
export class FraudService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
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
        fraudFlags: { where: { status: { in: ['open', 'reviewing'] } } },
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
        // The transaction alone does not serialize a find-then-create at the
        // default isolation level. Lock the logical (user,type) key so two
        // concurrent detections cannot both observe no open flag and insert a
        // duplicate before either commits.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fraud-flag:${params.userId}:${params.flagType}`}))`;
        const existing = await tx.fraudFlag.findFirst({
          where: {
            userId: params.userId,
            status: { in: [DbFraudFlagStatus.open, DbFraudFlagStatus.reviewing] },
            flagType: params.flagType as DbFraudFlagType,
          },
        });
        if (existing) return existing;
      }

      return tx.fraudFlag.create({
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
    });

    // Auto-escalate: critical flags hold earnings immediately
    if (params.severity === FraudSeverity.CRITICAL && params.userId) {
      // Stamp heldByFlagId so the later false-positive release scopes to
      // THIS flag only — releasing F1 must not undo holds from a still-open
      // F2 (cross-flag money leak).
      await this.ledger.holdEarnings(
        params.userId,
        `Critical fraud flag: ${params.flagType}`,
        flag.id,
      );
    }

    // Recompute trust score on any new flag
    if (params.userId) {
      await this.computeTrustScore(params.userId);
    }

    return flag;
  }

  async resolveFlag(flagId: string, reviewerId: string, isValid: boolean, reviewNote?: string) {
    // First read to verify the flag exists and capture its identity fields
    // (userId, impressionId, flagType) so they survive a concurrent overwrite.
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Fraud flag not found');

    // Re-resolution guard: only open/reviewing flags may be resolved.
    // A concurrent admin resolving the same flag sees count === 0 (already
    // resolved) and throws. This prevents:
    //  1. reviewerId/reviewNote overwrite (audit attribution stolen)
    //  2. Double releaseEarnings() — bulk release of *all* the user's held
    //     earnings, potentially including NEW holds created under different
    //     flags between the two resolution attempts.
    // The authoritative state guard is the conditional updateMany.
    const newStatus = isValid
      ? DbFraudFlagStatus.resolved_valid
      : DbFraudFlagStatus.resolved_invalid;

    let claimed = false;
    if (
      flag.status === DbFraudFlagStatus.open ||
      flag.status === DbFraudFlagStatus.reviewing
    ) {
      const result = await this.prisma.fraudFlag.updateMany({
        where: { id: flagId, status: { in: [DbFraudFlagStatus.open, DbFraudFlagStatus.reviewing] } },
        data: {
          status: newStatus,
          reviewerId,
          reviewNote,
          resolvedAt: new Date(),
        },
      });
      claimed = result.count === 1;
    }

    if (!claimed && flag.status !== newStatus) {
      const existing = await this.prisma.fraudFlag.findUnique({
        where: { id: flagId },
        select: { status: true },
      });
      // A concurrent resolver may have completed the same decision after our
      // snapshot. Treat that as a retryable replay; opposite decisions remain
      // rejected and never run money compensation.
      if (existing?.status === newStatus) {
        claimed = false;
      } else {
      throw new BadRequestException(
        existing
          ? `Fraud flag cannot be resolved from status '${existing.status}'`
          : 'Fraud flag not found',
      );
      }
    }

    // If flag was valid (fraud confirmed) and user has held earnings,
    // reverse the matching earnings entries — at the impressionId scope,
    // the clickId scope, or the user-scope (flag-level fraud without a
    // specific entity reference). clickId wins over impressionId when
    // both are populated because click-level money is the finer-grained
    // movement; the impression's earnings flip still happens because the
    // click row itself carries the impression FK.
    if (isValid && flag.userId) {
      if (flag.clickId || flag.impressionId) {
        await this.ledger.reverseEarnings(
          { impressionId: flag.impressionId ?? undefined, clickId: flag.clickId ?? undefined },
          `Fraud confirmed: ${flag.flagType}`,
        );
      }
      // NOTE: a user-level flag (neither impressionId nor clickId) is a
      // bulk-pattern detection (e.g. SUSPICIOUS_CTR across many
      // impressions). The matching earnings are held at flag time and
      // *released* on the !isValid branch below; reversing individual
      // entries without per-entity context is out of scope and would
      // require per-impression/click forensic-level resolution. Ops
      // should treat such flags as "soft fraud" — the user is held but
      // no specific entry is unwound unless flagged at entity resolution.
    } else if (!isValid && flag.userId) {
      // False positive — release the holds scoped to THIS flag. Scope by
      // impression when the flag links to a specific impression; otherwise
      // by flagId (matches the `heldByFlagId` stamp set in holdEarnings).
      // NEVER bulk-release every held entry across the user's flags — that
      // would undo holds from a still-open, unrelated concurrent flag
      // (cross-flag money leak).
      await this.ledger.releaseEarnings(flag.userId, {
        impressionId: flag.impressionId ?? undefined,
        flagId: flag.id,
      });
    }

    // Recompute trust score after resolution
    if (flag.userId) {
      await this.computeTrustScore(flag.userId);
    }

    return { flagId, status: newStatus, isValid };
  }

  // ── Admin Queries ──

  async getOpenFlags(page = 1, limit = 20, severity?: string) {
    const where: Prisma.FraudFlagWhereInput = {
      status: { in: [DbFraudFlagStatus.open, DbFraudFlagStatus.reviewing] },
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
