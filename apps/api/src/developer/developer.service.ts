import * as bcrypt from 'bcryptjs';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { LedgerStatus, PayoutStatus, primaryCurrency } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { eraseAccountIdentity } from '../common/utils/account-erasure';
import { buildCappedExportMeta, splitCappedRows } from '../common/utils/export-metadata';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { ACTIVE_FRAUD_FLAG_STATUSES } from '../fraud/fraud.constants';
import { FraudService } from '../fraud/fraud.service';

interface DeveloperSettingsUpdate {
  adsEnabled?: boolean;
  waitTelemetryEnabled?: boolean;
  waitTelemetryConsentAt?: Date;
  waitTelemetryPolicyVersion?: string;
  quietMode?: boolean;
  quietModeStart?: string;
  quietModeEnd?: string;
  maxAdsPerHour?: number;
  // `null` clears the stored tz (back to UTC); a string sets it.
  timezone?: string | null;
  blockedCategories?: string[];
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
  forfeitBalance?: boolean;
  auditActor?: DeleteAccountAuditActor;
}

const DEVELOPER_EXPORT_LIMITS = {
  earnings: 10000,
  impressions: 1000,
  clicks: 1000,
  payouts: 1000,
  consents: 1000,
};

@Injectable()
export class DeveloperService {
  constructor(
    private prisma: PrismaService,
    private fraud: FraudService,
    private audit: AuditService,
    private googleVerifier: GoogleTokenVerifier,
    private email: EmailQueueService,
  ) {}

  async getDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trustLevel: true, status: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'developer') throw new ForbiddenException('Not a developer account');
    const earnings = await this.getEarningsSummary(userId);
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId } });
    const settings = await this.ensureSettings(userId);
    const isHeld =
      user.trustLevel === 'new' || user.trustLevel === 'restricted' || user.trustLevel === 'banned';
    return {
      ...earnings,
      trustLevel: user.trustLevel,
      payoutHoldStatus: {
        isHeld,
        reason: isHeld ? `Account trust level: ${user.trustLevel}` : undefined,
      },
      settings,
      trustScore: trustScore?.score ?? 40,
    };
  }

  async getEarningsSummary(userId: string) {
    const entries = await this.prisma.earningsLedger.groupBy({
      by: ['status', 'entryType', 'currency'],
      where: { userId },
      _sum: { amountMinor: true },
    });
    const summary = {
      estimatedEarnings: 0n,
      confirmedEarnings: 0n,
      pendingEarnings: 0n,
      heldEarnings: 0n,
      reversedEarnings: 0n,
      recoveryDebtMinor: 0n,
      availableForPayoutMinor: 0n,
      lifetimeEarnings: 0n,
      estimatedEarningsByCurrency: {} as Record<string, bigint>,
      confirmedEarningsByCurrency: {} as Record<string, bigint>,
      pendingEarningsByCurrency: {} as Record<string, bigint>,
      heldEarningsByCurrency: {} as Record<string, bigint>,
      reversedEarningsByCurrency: {} as Record<string, bigint>,
      recoveryDebtByCurrency: {} as Record<string, bigint>,
      availableForPayoutByCurrency: {} as Record<string, bigint>,
      lifetimeEarningsByCurrency: {} as Record<string, bigint>,
    };
    for (const entry of entries) {
      const amountMinor = BigInt(entry._sum.amountMinor ?? 0);
      if (entry.entryType === 'debit') {
        addCurrencyAmount(summary.recoveryDebtByCurrency, entry.currency, amountMinor);
        if (entry.status !== 'reversed' && entry.status !== 'void') {
          addCurrencyAmount(summary.lifetimeEarningsByCurrency, entry.currency, -amountMinor);
          if (entry.status === 'confirmed') {
            addCurrencyAmount(summary.confirmedEarningsByCurrency, entry.currency, -amountMinor);
          }
        }
        continue;
      }

      // reversed entries are NOT credited toward lifetime — they represent
      // money that was earned but then clawed back (fraud reversal). Adding
      // them back into the displayed lifetime total inflates the metric.
      if (entry.status !== 'reversed') {
        addCurrencyAmount(summary.lifetimeEarningsByCurrency, entry.currency, amountMinor);
      }
      if (entry.status === 'estimated')
        addCurrencyAmount(summary.estimatedEarningsByCurrency, entry.currency, amountMinor);
      else if (entry.status === 'pending')
        addCurrencyAmount(summary.pendingEarningsByCurrency, entry.currency, amountMinor);
      else if (entry.status === 'confirmed')
        addCurrencyAmount(summary.confirmedEarningsByCurrency, entry.currency, amountMinor);
      else if (entry.status === 'held')
        addCurrencyAmount(summary.heldEarningsByCurrency, entry.currency, amountMinor);
      else if (entry.status === 'reversed')
        addCurrencyAmount(summary.reversedEarningsByCurrency, entry.currency, amountMinor);
    }
    summary.confirmedEarningsByCurrency = nonNegativeCurrencyTotals(
      summary.confirmedEarningsByCurrency,
    );
    // Seed availableForPayoutByCurrency from confirmedEarningsByCurrency
    // before subtracting in-flight allocations.
    summary.availableForPayoutByCurrency = { ...summary.confirmedEarningsByCurrency };
    // Subtract in-flight payout allocations from availableForPayout.
    // Without this correction, the developer dashboard mirrors confirmed earnings
    // as "available for payout" while a pending/processing payout already
    // reserves some of those same earnings entries — the developer sees a
    // withdrawable figure that the requestPayout path would reject as
    // "Insufficient available earnings". The authoritative getAvailableForPayout
    // (payout-summary.trait.ts) correctly excludes allocated entries; the
    // dashboard must do the same to avoid misleading the user.
    // Gate on confirmedEarningsByCurrency (a per-currency map) rather than
    // the scalar `confirmedEarnings`, which is computed further down. If any
    // currency has a confirmed-positive balance, query the allocations to
    // subtract any reserved entries from that currency's available headroom.
    if (Object.values(summary.confirmedEarningsByCurrency).some((v) => v > 0n)) {
      const RESERVED_PAYOUT_STATUSES = [
        PayoutStatus.REQUESTED,
        PayoutStatus.UNDER_REVIEW,
        PayoutStatus.APPROVED,
        PayoutStatus.PROCESSING,
      ];
      const allocatedRows = await this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: {
          userId,
          entryType: 'credit',
          status: 'confirmed',
          payoutAllocations: {
            some: {
              payoutRequest: { status: { in: RESERVED_PAYOUT_STATUSES } },
            },
          },
        },
        _sum: { amountMinor: true },
      });
      const allocatedRowObj: Record<string, bigint> = {};
      for (const row of allocatedRows) {
        addCurrencyAmount(allocatedRowObj, row.currency, row._sum.amountMinor ?? 0n);
      }
      for (const [currency, allocated] of Object.entries(allocatedRowObj)) {
        addCurrencyAmount(summary.availableForPayoutByCurrency, currency, -allocated);
      }
      summary.availableForPayoutByCurrency = nonNegativeCurrencyTotals(
        summary.availableForPayoutByCurrency,
      );
    }
    summary.lifetimeEarningsByCurrency = nonNegativeCurrencyTotals(
      summary.lifetimeEarningsByCurrency,
    );
    summary.reversedEarningsByCurrency = nonNegativeCurrencyTotals(
      summary.reversedEarningsByCurrency ?? {},
    );
    summary.estimatedEarnings =
      summary.estimatedEarningsByCurrency[primaryCurrency(summary.estimatedEarningsByCurrency)] ??
      0n;
    summary.confirmedEarnings =
      summary.confirmedEarningsByCurrency[primaryCurrency(summary.confirmedEarningsByCurrency)] ??
      0n;
    summary.pendingEarnings =
      summary.pendingEarningsByCurrency[primaryCurrency(summary.pendingEarningsByCurrency)] ?? 0n;
    summary.heldEarnings =
      summary.heldEarningsByCurrency[primaryCurrency(summary.heldEarningsByCurrency)] ?? 0n;
    summary.recoveryDebtMinor =
      summary.recoveryDebtByCurrency[primaryCurrency(summary.recoveryDebtByCurrency)] ?? 0n;
    summary.availableForPayoutMinor =
      summary.availableForPayoutByCurrency[primaryCurrency(summary.availableForPayoutByCurrency)] ??
      0n;
    summary.lifetimeEarnings =
      summary.lifetimeEarningsByCurrency[primaryCurrency(summary.lifetimeEarningsByCurrency)] ?? 0n;
    return summary;
  }

  async getEarnings(
    userId: string,
    params: { status?: string; from?: string; to?: string; page?: number; limit?: number },
  ) {
    const where: Prisma.EarningsLedgerWhereInput = { userId };
    if (params.status) where.status = params.status as LedgerStatus;
    if (params.from || params.to) {
      where.createdAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      };
    }
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [entries, total] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
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
    if (dto.waitTelemetryEnabled !== undefined) {
      data.waitTelemetryEnabled = dto.waitTelemetryEnabled;
      // Record consent time only for an affirmative, explicit update. Revoking
      // consent keeps the audit timestamp while immediately disabling use.
      if (dto.waitTelemetryEnabled) {
        data.waitTelemetryConsentAt = new Date();
      }
    }
    if (dto.waitTelemetryPolicyVersion !== undefined) {
      data.waitTelemetryPolicyVersion = dto.waitTelemetryPolicyVersion;
    }
    if (dto.quietMode !== undefined) data.quietMode = dto.quietMode;
    if (dto.quietModeStart !== undefined) data.quietModeStart = dto.quietModeStart;
    if (dto.quietModeEnd !== undefined) data.quietModeEnd = dto.quietModeEnd;
    if (dto.maxAdsPerHour !== undefined) data.maxAdsPerHour = dto.maxAdsPerHour;
    if (dto.blockedCategories !== undefined) data.blockedCategories = dto.blockedCategories;
    if (dto.timezone !== undefined) {
      // A-058: validate the IANA timezone string against the runtime's known
      // tz set so an attacker can't stash an arbitrary 64-char string (and so
      // a typo doesn't silently fall back to UTC). Empty string (or explicit
      // null) clears the field (back to UTC default); a non-empty value must be
      // a known tz.
      if (dto.timezone === '' || dto.timezone === null) {
        data.timezone = null;
      } else if (!isKnownTimezone(dto.timezone)) {
        throw new BadRequestException(
          `Unknown timezone '${dto.timezone}' — provide an IANA timezone identifier (e.g. America/New_York).`,
        );
      } else {
        data.timezone = dto.timezone;
      }
    }

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
        where: { userId, status: { in: ACTIVE_FRAUD_FLAG_STATUSES } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.fraudFlag.findMany({
        where: { userId, status: 'resolved_valid' },
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
    const [user, earningsRows, impressionRows, clickRows, payoutRows, consents] = await Promise.all(
      [
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            trustLevel: true,
            country: true,
            emailVerified: true,
            googleVerified: true,
            githubVerified: true,
            referralCode: true,
            createdAt: true,
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
          take: DEVELOPER_EXPORT_LIMITS.earnings + 1,
        }),
        this.prisma.adImpression.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: DEVELOPER_EXPORT_LIMITS.impressions + 1,
        }),
        this.prisma.adClick.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: DEVELOPER_EXPORT_LIMITS.clicks + 1,
        }),
        this.prisma.payoutRequest.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: DEVELOPER_EXPORT_LIMITS.payouts + 1,
        }),
        this.prisma.consent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: DEVELOPER_EXPORT_LIMITS.consents + 1,
        }),
      ],
    );
    const earnings = splitCappedRows(earningsRows, DEVELOPER_EXPORT_LIMITS.earnings);
    const impressions = splitCappedRows(impressionRows, DEVELOPER_EXPORT_LIMITS.impressions);
    const clicks = splitCappedRows(clickRows, DEVELOPER_EXPORT_LIMITS.clicks);
    const payouts = splitCappedRows(payoutRows, DEVELOPER_EXPORT_LIMITS.payouts);
    const consent = splitCappedRows(consents, DEVELOPER_EXPORT_LIMITS.consents);
    const exportMeta = buildCappedExportMeta({
      earnings: earnings.meta,
      impressions: impressions.meta,
      clicks: clicks.meta,
      payouts: payouts.meta,
      consent: consent.meta,
    });
    // Audit the self-service export request so bulk exfiltration via a
    // compromised token is traceable even after the data has left the
    // platform. The export body itself is not snapshotted (too large +
    // sensitive); completeness is reported in `exportMeta`.
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'export_data',
      targetType: 'user',
      targetId: userId,
    });
    return {
      profile: user,
      earnings: earnings.data,
      impressions: impressions.data,
      clicks: clicks.data,
      payouts: payouts.data,
      consent: consent.data,
      exportMeta,
    };
  }

  async deleteAccount(userId: string, options: DeleteAccountOptions = {}) {
    const auditActor = options.auditActor;
    if (!auditActor) {
      await this.verifySelfDeleteStepUp(userId, options);
    }

    const result = await eraseAccountIdentity(
      this.prisma,
      userId,
      {
        forfeitBalance: options.forfeitBalance ?? false,
      },
      this.audit,
      {
        actorId: auditActor?.actorId ?? userId,
        actorRole: auditActor?.actorRole ?? 'developer',
        action: auditActor?.action ?? 'delete_account',
      },
    );
    const priorEmail = result.priorEmail;

    // Send a deletion confirmation email (non-blocking; silent email
    // failures must never fail the deletion itself).
    if (priorEmail && !priorEmail.startsWith('deleted-')) {
      void this.email.sendAccountDeleted(priorEmail).catch(() => {
        this.audit.log({
          actorId: auditActor?.actorId ?? userId,
          actorRole: auditActor?.actorRole ?? 'developer',
          action: 'delete_account_email_failed',
          targetType: 'user',
          targetId: userId,
          // Provider errors can contain recipient/provider response data. Keep
          // the durable audit event useful without persisting that text.
          afterSnap: { reason: 'delivery_failed' },
        });
      });
    }
    return { deleted: true };
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
        throw new UnauthorizedException(
          'Google re-authentication is required to delete this account',
        );
      }
      const payload = await this.googleVerifier.verify(options.googleIdToken);
      if (
        !payload.email_verified ||
        payload.sub !== user.googleId ||
        payload.email !== user.email
      ) {
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

function addCurrencyAmount(totals: Record<string, bigint>, currency: string, amountMinor: bigint) {
  const key = currency.toUpperCase();
  totals[key] = (totals[key] ?? 0n) + amountMinor;
}

function nonNegativeCurrencyTotals(totals: Record<string, bigint>): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(totals).map(([currency, amountMinor]) => [
      currency,
      amountMinor > 0n ? amountMinor : 0n,
    ]),
  );
}

/**
 * A-058: returns true iff the supplied string is a real IANA timezone the
 * runtime can resolve (used for quiet-mode local-time evaluation). Caches the
 * tz-set per-process because `Intl.supportedValuesOf('timeZone')` would
 * otherwise rebuild it on every settings update. Falls back to destructured
 * validation if `supportedValuesOf` is unavailable (older runtimes) by probing
 * `Intl.DateTimeFormat` — an unknown tz throws RangeError there.
 */
const KNOWN_TIMEZONES = (() => {
  try {
    return new Set(Intl.supportedValuesOf('timeZone'));
  } catch {
    return null as Set<string> | null;
  }
})();

function isKnownTimezone(timezone: string): boolean {
  if (!timezone) return false;
  if (KNOWN_TIMEZONES) return KNOWN_TIMEZONES.has(timezone);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
