import * as bcrypt from 'bcryptjs';
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { LedgerStatus } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../email/email.service';
import { FraudService } from '../fraud/fraud.service';

interface DeveloperSettingsUpdate {
  adsEnabled?: boolean;
  quietMode?: boolean;
  quietModeStart?: string;
  quietModeEnd?: string;
  maxAdsPerHour?: number;
}

interface DeleteAccountAuditActor {
  actorId: string;
  actorRole: string;
  action?: string;
}

interface DeleteAccountOptions {
  confirmation?: string;
  currentPassword?: string;
  googleIdToken?: string;
  auditActor?: DeleteAccountAuditActor;
}

@Injectable()
export class DeveloperService {
  constructor(
    private prisma: PrismaService,
    private fraud: FraudService,
    private audit: AuditService,
    private googleVerifier: GoogleTokenVerifier,
    private email: EmailService,
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
    const entries = await this.prisma.earningsLedger.findMany({
      where: { userId },
      select: { status: true, entryType: true, amountMinor: true, currency: true },
    });
    const summary = {
      estimatedEarnings: 0,
      confirmedEarnings: 0,
      pendingEarnings: 0,
      heldEarnings: 0,
      reversedEarnings: 0,
      recoveryDebt: 0,
      availableForPayout: 0,
      lifetimeEarnings: 0,
      estimatedEarningsByCurrency: {} as Record<string, number>,
      confirmedEarningsByCurrency: {} as Record<string, number>,
      pendingEarningsByCurrency: {} as Record<string, number>,
      heldEarningsByCurrency: {} as Record<string, number>,
      recoveryDebtByCurrency: {} as Record<string, number>,
      availableForPayoutByCurrency: {} as Record<string, number>,
      lifetimeEarningsByCurrency: {} as Record<string, number>,
    };
    for (const entry of entries) {
      if (entry.entryType === 'debit') {
        addCurrencyAmount(summary.recoveryDebtByCurrency, entry.currency, entry.amountMinor);
        if (entry.status !== 'reversed' && entry.status !== 'void') {
          addCurrencyAmount(summary.lifetimeEarningsByCurrency, entry.currency, -entry.amountMinor);
          if (entry.status === 'confirmed') {
            addCurrencyAmount(summary.confirmedEarningsByCurrency, entry.currency, -entry.amountMinor);
          }
        }
        continue;
      }

      // reversed entries are NOT credited toward lifetime — they represent
      // money that was earned but then clawed back (fraud reversal). Adding
      // them back into the displayed lifetime total inflates the metric.
      if (entry.status !== 'reversed') {
        addCurrencyAmount(summary.lifetimeEarningsByCurrency, entry.currency, entry.amountMinor);
      }
      if (entry.status === 'estimated') addCurrencyAmount(summary.estimatedEarningsByCurrency, entry.currency, entry.amountMinor);
      else if (entry.status === 'pending') addCurrencyAmount(summary.pendingEarningsByCurrency, entry.currency, entry.amountMinor);
      else if (entry.status === 'confirmed') addCurrencyAmount(summary.confirmedEarningsByCurrency, entry.currency, entry.amountMinor);
      else if (entry.status === 'held') addCurrencyAmount(summary.heldEarningsByCurrency, entry.currency, entry.amountMinor);
      else if (entry.status === 'reversed') summary.reversedEarnings += entry.amountMinor;
    }
    summary.confirmedEarningsByCurrency = nonNegativeCurrencyTotals(summary.confirmedEarningsByCurrency);
    summary.availableForPayoutByCurrency = { ...summary.confirmedEarningsByCurrency };
    summary.lifetimeEarningsByCurrency = nonNegativeCurrencyTotals(summary.lifetimeEarningsByCurrency);
    summary.estimatedEarnings = summary.estimatedEarningsByCurrency.USD ?? 0;
    summary.confirmedEarnings = summary.confirmedEarningsByCurrency.USD ?? 0;
    summary.pendingEarnings = summary.pendingEarningsByCurrency.USD ?? 0;
    summary.heldEarnings = summary.heldEarningsByCurrency.USD ?? 0;
    summary.recoveryDebt = summary.recoveryDebtByCurrency.USD ?? 0;
    summary.availableForPayout = summary.availableForPayoutByCurrency.USD ?? 0;
    summary.lifetimeEarnings = summary.lifetimeEarningsByCurrency.USD ?? 0;
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
          twoFactorEnabled: true,
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
      twoFactorEnabled: user.twoFactorEnabled,
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
    const [user, earnings, impressions, clicks, payouts, consents] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, name: true, role: true, status: true,
          trustLevel: true, country: true, emailVerified: true, googleVerified: true,
          githubVerified: true, referralCode: true, createdAt: true,
        },
      }),
      // Capped at reasonable limits per entity to prevent OOM/stall on
      // high-volume developers (1M earnings rows would materialize the
      // entire ledger in memory).  Impressions/clicks are time-ordered;
      // the cap captures the most recent activity window.  Full export
      // requires paginated access via separate endpoints.
      this.prisma.earningsLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10000,
      }),
      this.prisma.adImpression.findMany({ where: { userId }, take: 1000 }),
      this.prisma.adClick.findMany({ where: { userId }, take: 1000 }),
      this.prisma.payoutRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.consent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    // Audit: a full PII export (GDPR-style data dump). Records who pulled
    // the dump so bulk exfiltration via a compromised token is traceable
    // even after the data has left the platform. The export body itself
    // is not snapshotted (too large + sensitive).
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'export_data',
      targetType: 'user',
      targetId: userId,
    });
    return { profile: user, earnings, impressions, clicks, payouts, consent: consents };
  }

  async deleteAccount(userId: string, options: DeleteAccountOptions = {}) {
    const auditActor = options.auditActor;
    if (!auditActor) {
      await this.verifySelfDeleteStepUp(userId, options);
    }

    // Capture the email before anonymization so we can send the deletion
    // confirmation to the user's real inbox.
    const prior = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const priorEmail = prior?.email;

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
          googleVerified: false,
          githubVerified: false,
          emailVerified: false,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          name: null,
          referralCode: null,
          country: null,
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
    void this.audit.log({
      actorId: auditActor?.actorId ?? userId,
      actorRole: auditActor?.actorRole ?? 'developer',
      action: auditActor?.action ?? 'delete_account',
      targetType: 'user',
      targetId: userId,
    });

    // Send a deletion confirmation email (non-blocking; silent email
    // failures must never fail the deletion itself).
    if (priorEmail && !priorEmail.startsWith('deleted-')) {
      void this.email.sendAccountDeleted(priorEmail).catch((err) => {
        this.audit.log({
          actorId: auditActor?.actorId ?? userId,
          actorRole: auditActor?.actorRole ?? 'developer',
          action: 'delete_account_email_failed',
          targetType: 'user',
          targetId: userId,
          afterSnap: { reason: err instanceof Error ? err.message : String(err) },
        });
      });
    }
    return result;
  }

  private async verifySelfDeleteStepUp(userId: string, options: DeleteAccountOptions) {
    if (options.confirmation !== 'DELETE_MY_ACCOUNT') {
      throw new ForbiddenException('Account deletion requires explicit confirmation');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, googleId: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.passwordHash) {
      if (!options.currentPassword) {
        throw new UnauthorizedException('Current password is required to delete this account');
      }
      const ok = await bcrypt.compare(options.currentPassword, user.passwordHash);
      if (!ok) {
        void this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'delete_account_reauth_failed',
          targetType: 'user',
          targetId: userId,
          afterSnap: { reason: 'bad_password' },
        });
        throw new UnauthorizedException('Invalid current password');
      }
      return;
    }

    if (user.googleId) {
      if (!options.googleIdToken) {
        throw new UnauthorizedException('Google re-authentication is required to delete this account');
      }
      const payload = await this.googleVerifier.verify(options.googleIdToken);
      if (!payload.email_verified || payload.sub !== user.googleId || payload.email !== user.email) {
        void this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'delete_account_reauth_failed',
          targetType: 'user',
          targetId: userId,
          afterSnap: { reason: 'google_mismatch' },
        });
        throw new UnauthorizedException('Invalid Google re-authentication token');
      }
      return;
    }

    throw new ForbiddenException(
      'This account has no supported self-service re-authentication method. Contact support for account erasure.',
    );
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

function addCurrencyAmount(totals: Record<string, number>, currency: string, amountMinor: number) {
  const key = currency.toUpperCase();
  totals[key] = (totals[key] ?? 0) + amountMinor;
}

function nonNegativeCurrencyTotals(totals: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(totals).map(([currency, amountMinor]) => [
      currency,
      Math.max(0, amountMinor),
    ]),
  );
}
