import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { Prisma } from '@waitlayer/db';
import { LedgerStatus } from '@waitlayer/shared';
import { FraudService } from '../fraud/fraud.service';
import { AuditService } from '../audit/audit.service';

interface DeveloperSettingsUpdate {
  adsEnabled?: boolean;
  quietMode?: boolean;
  quietModeStart?: string;
  quietModeEnd?: string;
  maxAdsPerHour?: number;
}

@Injectable()
export class DeveloperService {
  constructor(
    private prisma: PrismaService,
    private fraud: FraudService,
    private audit: AuditService,
  ) {}

  async getDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { trustLevel: true, status: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'developer') throw new ForbiddenException('Not a developer account');
    const earnings = await this.getEarningsSummary(userId);
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId } });
    const settings = await this.ensureSettings(userId);
    const isHeld = user.trustLevel === 'new' || user.trustLevel === 'restricted' || user.trustLevel === 'banned';
    return { ...earnings, trustLevel: user.trustLevel, payoutHoldStatus: { isHeld, reason: isHeld ? `Account trust level: ${user.trustLevel}` : undefined }, settings, trustScore: trustScore?.score ?? 40 };
  }

  async getEarningsSummary(userId: string) {
    const entries = await this.prisma.earningsLedger.findMany({ where: { userId }, select: { status: true, amountMinor: true } });
    const summary = { estimatedEarnings: 0, confirmedEarnings: 0, pendingEarnings: 0, heldEarnings: 0, availableForPayout: 0, lifetimeEarnings: 0 };
    for (const entry of entries) {
      summary.lifetimeEarnings += entry.amountMinor;
      if (entry.status === 'estimated') summary.estimatedEarnings += entry.amountMinor;
      else if (entry.status === 'pending') summary.pendingEarnings += entry.amountMinor;
      else if (entry.status === 'confirmed') summary.confirmedEarnings += entry.amountMinor;
      else if (entry.status === 'held') summary.heldEarnings += entry.amountMinor;
    }
    summary.availableForPayout = summary.confirmedEarnings;
    return summary;
  }

  async getEarnings(userId: string, params: { status?: string; from?: string; to?: string; page?: number; limit?: number }) {
    const where: Prisma.EarningsLedgerWhereInput = { userId };
    if (params.status) where.status = params.status as LedgerStatus;
    if (params.from || params.to) {
      where.createdAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      };
    }
    const page = params.page ?? 1; const limit = params.limit ?? 20;
    const [entries, total] = await Promise.all([
      this.prisma.earningsLedger.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.earningsLedger.count({ where }),
    ]);
    return { entries, total, page, limit };
  }

  async getSettings(userId: string) {
    const [user, settings] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          name: true,
          referralCode: true,
          emailVerified: true,
          googleVerified: true,
          githubVerified: true,
        },
      }),
      this.ensureSettings(userId),
    ]);

    if (!user) throw new NotFoundException('User not found');

    return {
      ...settings,
      email: user.email,
      displayName: user.name,
      referralCode: user.referralCode,
      emailVerified: user.emailVerified,
      googleVerified: user.googleVerified,
      githubLinked: user.githubVerified,
    };
  }

  async updateSettings(userId: string, dto: DeveloperSettingsUpdate) {
    const data: DeveloperSettingsUpdate = {};

    if (dto.adsEnabled !== undefined) data.adsEnabled = dto.adsEnabled;
    if (dto.quietMode !== undefined) data.quietMode = dto.quietMode;
    if (dto.quietModeStart !== undefined) data.quietModeStart = dto.quietModeStart;
    if (dto.quietModeEnd !== undefined) data.quietModeEnd = dto.quietModeEnd;
    if (dto.maxAdsPerHour !== undefined) data.maxAdsPerHour = dto.maxAdsPerHour;

    return this.prisma.userSettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  async getTrust(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'developer') throw new ForbiddenException('Not a developer account');

    await this.fraud.computeTrustScore(userId);

    const [trustScore, openFlags, recentPenalties] = await Promise.all([
      this.prisma.trustScore.findUnique({ where: { userId } }),
      this.prisma.fraudFlag.findMany({
        where: { userId, status: { in: ['open', 'reviewing'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.fraudFlag.findMany({
        where: { userId, status: { in: ['resolved_valid', 'escalated'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);

    const score = trustScore?.score ?? 40;
    const fraudPenaltyPts = trustScore?.fraudPenaltyPts ?? 0;

    return {
      score,
      level: trustScore?.level ?? 'new',
      band: this.getTrustBand(score),
      computedAt: trustScore?.computedAt,
      factors: [
        {
          key: 'baseline',
          label: 'Baseline',
          points: 40,
          maxPoints: 40,
          detail: 'Starting score for a new developer account.',
        },
        {
          key: 'account_age',
          label: 'Account age',
          points: trustScore?.accountAgePoints ?? 0,
          maxPoints: 15,
          detail: 'Older accounts build trust gradually.',
        },
        {
          key: 'email_verified',
          label: 'Email verified',
          points: trustScore?.emailVerifiedPts ?? 0,
          maxPoints: 10,
          detail: 'Verified email improves account confidence.',
        },
        {
          key: 'github_verified',
          label: 'GitHub verified',
          points: trustScore?.githubVerifiedPts ?? 0,
          maxPoints: 15,
          detail: 'Linked developer identity improves payout trust.',
        },
        {
          key: 'google_verified',
          label: 'Google verified',
          points: trustScore?.googleVerifiedPts ?? 0,
          maxPoints: 15,
          detail: 'Verified Google sign-in strengthens identity checks.',
        },
        {
          key: 'device_consistency',
          label: 'Device consistency',
          points: trustScore?.deviceConsistPts ?? 0,
          maxPoints: 10,
          detail: 'Stable device usage lowers fraud risk.',
        },
        {
          key: 'activity_pattern',
          label: 'Activity pattern',
          points: trustScore?.activityPatternPts ?? 0,
          maxPoints: 10,
          detail: 'Consistent usage patterns improve confidence.',
        },
        {
          key: 'payout_history',
          label: 'Payout history',
          points: trustScore?.payoutHistoryPts ?? 0,
          maxPoints: 20,
          detail: 'Successful payouts increase account maturity.',
        },
        {
          key: 'fraud_record',
          label: 'Fraud record',
          points: Math.max(0, 20 - fraudPenaltyPts),
          maxPoints: 20,
          detail: `${fraudPenaltyPts} point${fraudPenaltyPts === 1 ? '' : 's'} deducted from active flags.`,
        },
      ],
      openFlags: openFlags.map((flag) => ({
        id: flag.id,
        severity: flag.severity,
        reason: flag.flagType.replace(/_/g, ' '),
        createdAt: flag.createdAt,
      })),
      recentPenalties: recentPenalties.map((flag) => ({
        id: flag.id,
        severity: flag.severity,
        type: flag.flagType,
        description: flag.reviewNote || flag.flagType.replace(/_/g, ' '),
        appliedAt: flag.resolvedAt || flag.updatedAt,
      })),
    };
  }

  async exportData(userId: string) {
    const [user, earnings, impressions, clicks, payouts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, name: true, role: true, status: true,
          trustLevel: true, country: true, emailVerified: true, googleVerified: true,
          githubVerified: true, referralCode: true, createdAt: true,
        },
      }),
      this.prisma.earningsLedger.findMany({ where: { userId } }),
      this.prisma.adImpression.findMany({ where: { userId }, take: 1000 }),
      this.prisma.adClick.findMany({ where: { userId }, take: 1000 }),
      this.prisma.payoutRequest.findMany({ where: { userId } }),
    ]);
    // Audit: a full PII export (GDPR-style data dump). Records who pulled
    // the dump so bulk exfiltration via a compromised token is traceable
    // even after the data has left the platform. The export body itself
    // is not snapshotted (too large + sensitive).
    this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'export_data',
      targetType: 'user',
      targetId: userId,
    });
    return { user, earnings, impressions, clicks, payouts };
  }

  async deleteAccount(userId: string) {
    // Anonymize user data, revoke all sessions and API keys.
    // The FK ON DELETE SET NULL on api_keys.ownerId will null the owner
    // column when the User row is eventually hard-deleted; this explicit
    // bulk-revoke ensures keys are inert NOW even without a hard-delete.
    const result = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'deleted',
          email: `deleted-${userId}@waitlayer.com`,
          passwordHash: null,
          googleId: null,
          githubId: null,
          name: null,
          referralCode: null,
        },
      }),
      this.prisma.session.updateMany({
        where: { userId },
        data: { revoked: true },
      }),
      this.prisma.apiKey.updateMany({
        where: { ownerId: userId },
        data: { isActive: false },
      }),
    ]);
    // Audit: account self-deletion is an irreversible destructive action.
    // Record it so a malicious deletion (compromised token) leaves a
    // forensic trail separate from the (now-anonymized) row itself.
    this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'delete_account',
      targetType: 'user',
      targetId: userId,
    });
    return result;
  }

  private ensureSettings(userId: string) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  private getTrustBand(score: number) {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }
}
