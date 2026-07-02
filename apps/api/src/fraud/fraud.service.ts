import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RATE_LIMITS, TRUST_SCORE, FraudSeverity, FraudFlagType } from '@waitlayer/shared';

@Injectable()
export class FraudService {
  constructor(private prisma: PrismaService, private ledger: LedgerService) {}

  // ── Rate Limit Checks ──

  async checkImpressionRateLimit(userId: string, deviceId: string): Promise<{ allowed: boolean; reason?: string }> {
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

  async checkClickPatterns(userId: string, impressionId: string): Promise<{ allowed: boolean; reason?: string }> {
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
  async checkSelfClick(userId: string, campaignId: string): Promise<{ allowed: boolean; reason?: string }> {
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        trustScore: true,
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
    const deviceCount = await this.prisma.device.count({ where: { userId } });
    const deviceConsistPts = deviceCount === 1 ? 10 : deviceCount <= 3 ? 5 : 0;
    score += deviceConsistPts;

    // Activity pattern: based on consistent usage (max 10)
    const daysActive = await this.prisma.waitStateEvent.groupBy({
      by: ['userId'],
      where: {
        userId,
        eventType: 'wait_state_start',
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      _count: true,
    });
    const activityPatternPts = Math.min(10, Math.floor((daysActive[0]?._count || 0) / 3));
    score += activityPatternPts;

    // Payout history: +5 per successful payout, max 20
    const paidPayouts = await this.prisma.payoutRequest.count({
      where: { userId, status: 'paid' },
    });
    const payoutHistoryPts = Math.min(20, paidPayouts * 5);
    score += payoutHistoryPts;

    // Fraud penalties: subtract based on severity
    const fraudPenaltyPts = user.fraudFlags.reduce((acc: number, f: { severity: string }) => {
      switch (f.severity) {
        case 'critical': return acc + 20;
        case 'high': return acc + 10;
        case 'medium': return acc + 5;
        case 'low': return acc + 1;
        default: return acc;
      }
    }, 0);
    score -= fraudPenaltyPts;

    // Clamp to [0, 100]
    score = Math.max(TRUST_SCORE.MIN, Math.min(TRUST_SCORE.MAX, score));

    // Determine trust level
    const level = score >= TRUST_SCORE.THRESHOLDS.HIGH_TRUST ? 'high_trust'
      : score >= TRUST_SCORE.THRESHOLDS.NORMAL ? 'normal'
      : score >= TRUST_SCORE.THRESHOLDS.LOW_TRUST ? 'low_trust'
      : 'new';

    // Update trust score record
    await this.prisma.trustScore.upsert({
      where: { userId },
      create: {
        userId,
        score: score as any,
        level: level as any,
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
        score: score as any,
        level: level as any,
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

    // Update user trust level
    await this.prisma.user.update({
      where: { id: userId },
      data: { trustLevel: level as any },
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
    // Deduplicate: don't create duplicate open flags for same user + type
    if (params.userId) {
      const existing = await this.prisma.fraudFlag.findFirst({
        where: {
          userId: params.userId,
          status: 'open',
          flagType: params.flagType as any,
        },
      });
      if (existing) return existing;
    }

    const flag = await this.prisma.fraudFlag.create({
      data: {
        userId: params.userId || undefined,
        deviceId: params.deviceId || undefined,
        campaignId: params.campaignId || undefined,
        impressionId: params.impressionId || undefined,
        clickId: params.clickId || undefined,
        flagType: params.flagType as any,
        severity: params.severity as any,
        evidence: params.evidence as any,
        scoreDelta: params.scoreDelta ?? 0,
      },
    });

    // Auto-escalate: critical flags hold earnings immediately
    if (params.severity === FraudSeverity.CRITICAL && params.userId) {
      await this.ledger.holdEarnings(params.userId, `Critical fraud flag: ${params.flagType}`);
    }

    // Recompute trust score on any new flag
    if (params.userId) {
      await this.computeTrustScore(params.userId);
    }

    return flag;
  }

  async resolveFlag(flagId: string, reviewerId: string, isValid: boolean, reviewNote?: string) {
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Fraud flag not found');

    const status = isValid ? 'resolved_valid' : 'resolved_invalid';

    await this.prisma.fraudFlag.update({
      where: { id: flagId },
      data: {
        status: status as any,
        reviewerId,
        reviewNote,
        resolvedAt: new Date(),
      },
    });

    // If flag was valid (fraud confirmed) and user has held earnings
    if (isValid && flag.userId) {
      // Reverse earnings related to this flag if it's a confirmed fraud
      if (flag.impressionId) {
        await this.ledger.reverseEarnings(flag.impressionId, `Fraud confirmed: ${flag.flagType}`);
      }
    } else if (!isValid && flag.userId) {
      // False positive — release held earnings
      await this.ledger.releaseEarnings(flag.userId);
    }

    // Recompute trust score after resolution
    if (flag.userId) {
      await this.computeTrustScore(flag.userId);
    }

    return { flagId, status, isValid };
  }

  // ── Admin Queries ──

  async getOpenFlags(page = 1, limit = 20, severity?: string) {
    const where: any = { status: { in: ['open', 'reviewing'] } };
    if (severity) where.severity = severity;

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
    const [open, reviewing, resolvedValid, resolvedInvalid, escalated] =
      await Promise.all([
        this.prisma.fraudFlag.count({ where: { status: 'open' } }),
        this.prisma.fraudFlag.count({ where: { status: 'reviewing' } }),
        this.prisma.fraudFlag.count({ where: { status: 'resolved_valid' } }),
        this.prisma.fraudFlag.count({ where: { status: 'resolved_invalid' } }),
        this.prisma.fraudFlag.count({ where: { status: 'escalated' } }),
      ]);

    return { open, reviewing, resolvedValid, resolvedInvalid, escalated };
  }
}
