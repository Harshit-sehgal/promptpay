import { Injectable, BadRequestException } from '@nestjs/common';
import { FraudFlagStatus, FraudSeverity, Prisma, RecoveryDebtCaseStatus, UserRole, UserStatus } from '@waitlayer/db';
import * as crypto from 'crypto';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayoutService } from '../payout/payout.service';
import { FraudService } from '../fraud/fraud.service';
import { getErrorCode } from '../common/utils/errors';

const DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES = 15;
const MAX_DEVICE_RECOVERY_TOKEN_MINUTES = 60;
const DEFAULT_RECOVERY_DEBT_CURRENCY = 'USD';
const ACTIVE_RECOVERY_DEBT_CASE_STATUSES = [
  RecoveryDebtCaseStatus.open,
  RecoveryDebtCaseStatus.in_collections,
];

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private payoutService: PayoutService,
    private fraudService: FraudService,
  ) {}

  async getOverview() {
    const [users, campaigns, impressions, payouts, fraudFlags] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.campaign.count({ where: { status: 'active' } }),
      this.prisma.adImpression.count({ where: { isBillable: true } }),
      this.prisma.earningsLedger.aggregate({ where: { status: 'paid', entryType: 'credit' }, _sum: { amountMinor: true } }),
      this.prisma.fraudFlag.count({ where: { status: 'open' } }),
    ]);
    return { activeUsers: users, activeCampaigns: campaigns, totalBillableImpressions: impressions, totalPayoutsMinor: payouts._sum.amountMinor || 0, openFraudFlags: fraudFlags };
  }

  async getUsers(params: { status?: string; role?: string; search?: string }) {
    const where: Prisma.UserWhereInput = {};
    if (params.status) where.status = params.status as UserStatus;
    if (params.role) where.role = params.role as UserRole;
    if (params.search) where.OR = [{ email: { contains: params.search, mode: 'insensitive' } }, { name: { contains: params.search, mode: 'insensitive' } }];
    return this.prisma.user.findMany({ where, select: { id: true, email: true, name: true, role: true, status: true, trustLevel: true, country: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async getPendingCampaigns() {
    return this.prisma.campaign.findMany({ where: { status: { in: ['submitted', 'approved'] } }, include: { advertiser: { select: { companyName: true } }, creatives: true }, orderBy: { submittedAt: 'asc' } });
  }

  async approveCampaign(campaignId: string, reviewerId: string, reason?: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, include: { creatives: true } });
    if (!campaign || campaign.status !== 'submitted') {
      throw new BadRequestException('Campaign must be in submitted status to approve');
    }

    // Must have at least one approved creative and remaining budget to activate
    const hasApprovedCreative = campaign.creatives.some((c) => c.status === 'approved');
    const hasBudget = campaign.budgetSpentMinor < campaign.budgetTotalMinor;
    const canActivate = hasApprovedCreative && hasBudget;

    // Set status: 'approved' if no approved creatives yet or no budget, 'active' if ready to serve
    const newStatus = canActivate ? 'active' : 'approved';

    // Build human-readable blockers list for the UI
    const blockers: string[] = [];
    if (!hasApprovedCreative) {
      const pendingCount = campaign.creatives.filter((c) => c.status === 'pending_review').length;
      const draftCount = campaign.creatives.filter((c) => c.status === 'draft').length;
      blockers.push(
        `No approved creatives (${pendingCount} pending review, ${draftCount} draft). Approve at least one creative to activate.`,
      );
    }
    if (!hasBudget) {
      blockers.push('Campaign budget is fully spent. Add more budget to activate.');
    }

    // CAS-gated status flip: `updateMany` where `{ id, status: 'submitted' }`
    // returns count===0 when the campaign was concurrently approved/rejected.
    // Without this gate, two concurrent admin approvals would both insert
    // duplicate CampaignApproval rows, overwrite each other's approvedAt
    // timestamps, and the result would depend on commit order — neither
    // "always safe", both wrong in a different way.
    const result = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.campaign.updateMany({
        where: { id: campaignId, status: 'submitted' },
        data: {
          status: newStatus,
          approvedAt: new Date(),
          activatedAt: canActivate ? new Date() : null,
        },
      });
      if (flip.count === 0) {
        throw new BadRequestException(
          'Campaign was just approved or rejected by another reviewer. Reload the page to see the current state.',
        );
      }

      await tx.campaignApproval.create({
        data: { campaignId, reviewerId, decision: 'approved', reason },
      });

      const freshCampaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        include: { creatives: true },
      });
      return { campaign: freshCampaign };
    });

    return {
      campaign: result.campaign,
      activated: canActivate,
      status: newStatus,
      blockers,
    };
  }

  async rejectCampaign(campaignId: string, reviewerId: string, reason: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'submitted') {
      throw new BadRequestException('Campaign must be in submitted status to reject');
    }
    return this.prisma.$transaction(async (tx) => {
      const flip = await tx.campaign.updateMany({
        where: { id: campaignId, status: 'submitted' },
        data: { status: 'rejected' },
      });
      if (flip.count === 0) {
        throw new BadRequestException(
          'Campaign was just approved or rejected by another reviewer. Reload the page to see the current state.',
        );
      }
      await tx.campaignApproval.create({
        data: { campaignId, reviewerId, decision: 'rejected', reason },
      });
      return flip;
    });
  }

  async getPendingPayouts() {
    return this.prisma.payoutRequest.findMany({ where: { status: { in: ['requested', 'under_review'] } }, include: { user: { select: { email: true, name: true, trustLevel: true } }, payoutAccount: true }, orderBy: { createdAt: 'asc' } });
  }

  async approvePayout(
    payoutId: string,
    reviewerId: string,
    note?: string,
    approvedAmountMinor?: number,
  ) {
    // Conditional update: only approve from a reviewable state. This prevents
    // an admin (or a compromised admin token) from re-approving a payout that
    // is already `paid`/`processing` (destroying the payment audit trail) or
    // resurrecting a `rejected`/`cancelled`/`failed` payout. `count === 0`
    // means the payout is missing or not in a reviewable state — surface that
    // rather than silently no-op.
    //
    // Amount reconciliation: always set `approvedAmountMinor` authorita-
    // tively. Previously the column was never written, so the reconciliation
    // guards in `processPayout` and `markPayoutPaid` (which prefer
    // `approvedAmountMinor ?? requestedAmountMinor`) silently fell back to
    // the requested amount — a deliberately-reduced approval would still be
    // paid at the higher requested figure. Now:
    //   - partial approval: `approvedAmountMinor` (validated `> 0` and
    //     `<= requestedAmountMinor`) — the payout is authorised at the
    //     reduced figure.
    //   - full approval (omitted): `approvedAmountMinor = requestedAmountMinor`
    //     — explicit, so the reconciliation prefers the APPROVED value
    //     rather than the requested one going forward.
    if (approvedAmountMinor !== undefined) {
      if (!Number.isInteger(approvedAmountMinor) || approvedAmountMinor <= 0) {
        throw new BadRequestException('approvedAmountMinor must be a positive integer');
      }
    }

    // Read BEFORE the conditional update to validate a partial-approval amount
    // AND resolve the full-approval amount (requestedAmountMinor). The
    // conditional update below is the authoritative state guard; this read is
    // just the bounds/data check — a TOCTOU between this read and the update
    // cannot inflate the approved amount because requestedAmountMinor is
    // immutable post-request (see PayoutRequest schema).
    const target = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      select: { requestedAmountMinor: true, currency: true },
    });
    if (!target) throw new BadRequestException('Payout not found');

    let resolvedApprovedAmount: number;
    if (approvedAmountMinor !== undefined) {
      // Partial approval — validated against requested
      if (approvedAmountMinor > target.requestedAmountMinor) {
        throw new BadRequestException(
          `approvedAmountMinor (${approvedAmountMinor}) cannot exceed requestedAmountMinor (${target.requestedAmountMinor})`,
        );
      }
      resolvedApprovedAmount = approvedAmountMinor;
    } else {
      // Full approval — use the requested amount. We read it now and write
      // it in the single updateMany below so approvedAmountMinor is
      // authoritative from the moment the row flips, rather than null
      // briefly between two writes.
      resolvedApprovedAmount = target.requestedAmountMinor;
    }

    const result = await this.prisma.payoutRequest.updateMany({
      where: { id: payoutId, status: { in: ['requested', 'under_review'] } },
      data: {
        status: 'approved',
        reviewerId,
        reviewNote: note,
        processedAt: new Date(),
        approvedAmountMinor: resolvedApprovedAmount,
      },
    });
    if (result.count === 0) {
      const existing = await this.prisma.payoutRequest.findUnique({ where: { id: payoutId }, select: { status: true } });
      throw new BadRequestException(
        existing
          ? `Payout cannot be approved from status '${existing.status}'`
          : 'Payout not found',
      );
    }

    return this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
  }

  async rejectPayout(payoutId: string, reviewerId: string, reason: string) {
    // Only reject from a pre-payment state. Rejecting an already-`paid` payout
    // would contradict the ledger (earnings are already `paid`); rejecting a
    // `processing` payout risks a stuck provider call with no DB record.
    //
    // **Allocation cleanup**: PayoutAllocation rows have a `@@unique([earningsEntryId])`
    // floor that prevents concurrent double-allocation between racing
    // `requestPayout` calls. Stale allocations from a now-rejected request
    // would prevent the developer from re-requesting against those same
    // earnings (they'd hit the unique-key error in `requestPayout`). Delete
    // the rejected request's allocations in the SAME transaction so the
    // earnings entries become re-available for a fresh payout attempt.
    const result = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.payoutRequest.updateMany({
        where: { id: payoutId, status: { in: ['requested', 'under_review', 'approved'] } },
        data: { status: 'rejected', reviewerId, reviewNote: reason },
      });
      if (flip.count === 0) return { flipped: false as const };
      await tx.payoutAllocation.deleteMany({
        where: { payoutRequestId: payoutId },
      });
      return { flipped: true as const };
    });
    if (!result.flipped) {
      const existing = await this.prisma.payoutRequest.findUnique({ where: { id: payoutId }, select: { status: true } });
      throw new BadRequestException(
        existing
          ? `Payout cannot be rejected from status '${existing.status}'`
          : 'Payout not found',
      );
    }
    return this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
  }

  async markPayoutPaid(payoutId: string, data: { providerTxId: string; paidAt: string; amountMinor: number; currency: string }) {
    // The DTO carries amountMinor + currency so the admin's body can be
    // cross-checked against the payout's stored values before flipping it to
    // `paid`. Previously these fields were dropped silently — a transposed
    // digit in the admin's body would still mark the (wrong) payout as paid.
    // We surface the cross-check inside the payout service so the flip is
    // atomic with the validation (re-read inside the tx).
    return this.payoutService.markPayoutPaid(payoutId, {
      providerTxId: data.providerTxId,
      paidAt: data.paidAt,
      expectedAmountMinor: data.amountMinor,
      expectedCurrency: data.currency,
    });
  }

  async recomputeTrustScore(userId: string) {
    return this.fraudService.computeTrustScore(userId);
  }

  async getFraudFlags(params: {
    status?: string;
    severity?: string;
    flagType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.FraudFlagWhereInput = {};
    // Support comma-separated statuses: "open,reviewing" or "resolved_valid,resolved_invalid"
    if (params.status) {
      const statuses = params.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.status = statuses[0] as FraudFlagStatus;
      } else if (statuses.length > 1) {
        where.status = { in: statuses as FraudFlagStatus[] };
      }
    }
    if (params.severity) where.severity = params.severity as FraudSeverity;
    if (params.flagType) (where as { flagType: string }).flagType = params.flagType;

    // Search by user email
    if (params.search) {
      const matchingUsers = await this.prisma.user.findMany({
        where: {
          email: { contains: params.search, mode: 'insensitive' },
        },
        select: { id: true },
      });
      where.userId = { in: matchingUsers.map((u) => u.id) };
    }

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 20));

    const [flags, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, name: true, trustLevel: true } },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    return {
      flags,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFraudStats() {
    const [
      byStatus,
      bySeverity,
      byFlagType,
      total,
      resolved7d,
      resolvedFlags,
    ] = await Promise.all([
      Promise.all(
        (['open', 'reviewing', 'resolved_valid', 'resolved_invalid', 'escalated'] as FraudFlagStatus[]).map((status) =>
          this.prisma.fraudFlag.count({ where: { status } }),
        ),
      ),
      Promise.all(
        (['critical', 'high', 'medium', 'low'] as FraudSeverity[]).map((severity) =>
          this.prisma.fraudFlag.count({ where: { severity, status: { in: ['open', 'reviewing'] as FraudFlagStatus[] } } }),
        ),
      ),
      this.prisma.fraudFlag.groupBy({
        by: ['flagType'],
        _count: { _all: true },
        where: { status: { in: ['open', 'reviewing'] as FraudFlagStatus[] } },
      }),
      this.prisma.fraudFlag.count(),
      this.prisma.fraudFlag.count({
        where: {
          status: { in: ['resolved_valid', 'resolved_invalid'] as FraudFlagStatus[] },
          resolvedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      // Fetch resolved flags with createdAt + resolvedAt to compute avg resolution time in-memory
      // (Prisma's _avg does not support DateTime fields in TypeScript types)
      this.prisma.fraudFlag.findMany({
        where: { resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        take: 1000, // Sanity cap — enough for a meaningful average
      }),
    ]);

    const [open, reviewing, resolvedValid, resolvedInvalid, escalated] = byStatus;
    const [critical, high, medium, low] = bySeverity;
    const totalResolved = resolvedValid + resolvedInvalid;
    const escalationRate = totalResolved > 0
      ? Math.round((resolvedValid / totalResolved) * 100)
      : 0;

    // Calculate average resolution time in minutes (in-memory)
    let avgResolutionMins = 0;
    if (resolvedFlags.length > 0) {
      let totalMs = 0;
      let count = 0;
      for (const f of resolvedFlags) {
        if (f.createdAt && f.resolvedAt) {
          totalMs += new Date(f.resolvedAt).getTime() - new Date(f.createdAt).getTime();
          count++;
        }
      }
      avgResolutionMins = count > 0 ? Math.round(totalMs / count / (1000 * 60)) : 0;
    }

    return {
      byStatus: { open, reviewing, resolvedValid, resolvedInvalid, escalated },
      bySeverity: { critical, high, medium, low },
      byFlagType: byFlagType.map((t) => ({ type: t.flagType, count: t._count._all })),
      total,
      resolvedLast7d: resolved7d,
      escalationRate,
      avgResolutionMinutes: avgResolutionMins,
    };
  }

  async resolveFraudFlag(flagId: string, reviewerId: string, decision: string, note?: string) {
    // Delegate to FraudService.resolveFlag so admin and non-admin paths share
    // the same earnings reversal / release + trust recompute logic.
    // decision: 'confirmed' = fraud was valid (reverse earnings)
    //           'rejected' = false positive (release held earnings)
    const isValid = decision === 'confirmed';
    return this.fraudService.resolveFlag(flagId, reviewerId, isValid, note);
  }

  async getAuditLog(params: { actorId?: string; actorRole?: string; targetType?: string; from?: string; to?: string; page?: number; limit?: number }) {
    return this.audit.query(params);
  }

  // ── Device Recovery ──

  async issueDeviceRecoveryToken(params: {
    deviceId: string;
    userId: string;
    reviewerId: string;
    reviewerRole?: string;
    reason?: string;
    expiresInMinutes?: number;
  }) {
    const expiresInMinutes = params.expiresInMinutes ?? DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES;
    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > MAX_DEVICE_RECOVERY_TOKEN_MINUTES) {
      throw new BadRequestException(
        `expiresInMinutes must be an integer between 5 and ${MAX_DEVICE_RECOVERY_TOKEN_MINUTES}`,
      );
    }

    const device = await this.prisma.device.findUnique({
      where: { id: params.deviceId },
      select: {
        id: true,
        userId: true,
        fingerprintHash: true,
        eventSecret: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
    });
    if (!device || device.userId !== params.userId) {
      throw new BadRequestException('Device was not found for the requested user');
    }
    if (device.user.role !== 'developer') {
      throw new BadRequestException('Only developer extension devices can receive recovery tokens');
    }
    if (device.user.status === 'banned' || device.user.status === 'deleted') {
      throw new BadRequestException('Device recovery is unavailable for this account status');
    }
    if (!device.eventSecret) {
      throw new BadRequestException('Legacy devices without a per-device secret can re-register without a support token');
    }

    const recoverySupportToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashDeviceRecoveryToken(recoverySupportToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60_000);
    const reason = params.reason?.trim() || undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.deviceRecoveryToken.updateMany({
        where: {
          userId: params.userId,
          deviceId: params.deviceId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      return tx.deviceRecoveryToken.create({
        data: {
          userId: params.userId,
          deviceId: params.deviceId,
          createdByUserId: params.reviewerId,
          tokenHash,
          reason,
          expiresAt,
        },
      });
    });

    await this.audit.log({
      actorId: params.reviewerId,
      actorRole: params.reviewerRole ?? 'admin',
      action: 'device_recovery_token_issued',
      targetType: 'device',
      targetId: params.deviceId,
      afterSnap: {
        userId: params.userId,
        tokenId: created.id,
        expiresAt: expiresAt.toISOString(),
        reason,
      },
    });

    return {
      tokenId: created.id,
      userId: params.userId,
      deviceId: params.deviceId,
      expiresAt,
      recoverySupportToken,
    };
  }

  // ── Recovery Debt Operations ──

  async getRecoveryDebtCases(params: { page?: number; limit?: number; minAmountMinor?: number; currency?: string }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const minAmountMinor = Math.max(1, params.minAmountMinor ?? 1);
    const currency = normalizeOptionalCurrency(params.currency);
    const currencyFilter = currency ? { currency } : {};

    const [debitGroups, creditGroups] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'debit', ...currencyFilter },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'credit', ...currencyFilter },
        _sum: { amountMinor: true },
      }),
    ]);

    const creditByUserCurrency = new Map<string, number>();
    for (const credit of creditGroups) {
      creditByUserCurrency.set(
        `${credit.userId}:${credit.currency}`,
        credit._sum.amountMinor ?? 0,
      );
    }

    const allDebtRows = debitGroups
      .map((debit) => {
        const debitMinor = debit._sum.amountMinor ?? 0;
        const confirmedCreditMinor = creditByUserCurrency.get(`${debit.userId}:${debit.currency}`) ?? 0;
        const outstandingDebtMinor = Math.max(0, debitMinor - confirmedCreditMinor);
        return {
          userId: debit.userId,
          currency: debit.currency,
          confirmedDebitMinor: debitMinor,
          confirmedCreditMinor,
          outstandingDebtMinor,
          recoveryDebitEntryCount: debit._count._all,
        };
      })
      .filter((row) => row.outstandingDebtMinor >= minAmountMinor)
      .sort((a, b) => b.outstandingDebtMinor - a.outstandingDebtMinor || a.userId.localeCompare(b.userId));

    const total = allDebtRows.length;
    const rows = allDebtRows.slice((page - 1) * limit, page * limit);
    const userIds = Array.from(new Set(rows.map((row) => row.userId)));
    const currencies = Array.from(new Set(rows.map((row) => row.currency)));
    const [users, cases] = userIds.length > 0
      ? await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true, status: true, trustLevel: true },
        }),
        this.prisma.recoveryDebtCase.findMany({
          where: { userId: { in: userIds }, currency: { in: currencies } },
          orderBy: { updatedAt: 'desc' },
        }),
      ])
      : [[], []];

    const userById = new Map(users.map((user) => [user.id, user]));
    const latestCaseByUserCurrency = new Map<string, (typeof cases)[number]>();
    for (const debtCase of cases) {
      const key = recoveryDebtCaseKey(debtCase.userId, debtCase.currency);
      if (!latestCaseByUserCurrency.has(key)) {
        latestCaseByUserCurrency.set(key, debtCase);
      }
    }

    return {
      items: rows.map((row) => ({
        ...row,
        user: userById.get(row.userId) ?? null,
        latestCase: latestCaseByUserCurrency.get(recoveryDebtCaseKey(row.userId, row.currency)) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async openRecoveryDebtCase(params: {
    userId: string;
    reviewerId: string;
    reviewerRole?: string;
    status?: 'open' | 'in_collections';
    currency?: string;
    externalReference?: string;
    note?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (user.role !== 'developer') {
      throw new BadRequestException('Recovery debt cases can only be opened for developer accounts');
    }

    const requestedCurrency = normalizeOptionalCurrency(params.currency) ?? DEFAULT_RECOVERY_DEBT_CURRENCY;
    const debt = await this.getOutstandingRecoveryDebt(params.userId, requestedCurrency);
    if (debt.outstandingDebtMinor <= 0) {
      throw new BadRequestException('User has no outstanding recovery debt');
    }

    const status = params.status === 'in_collections'
      ? RecoveryDebtCaseStatus.in_collections
      : RecoveryDebtCaseStatus.open;
    const note = sanitizeOptionalString(params.note);
    const externalReference = sanitizeOptionalString(params.externalReference);

    const debtCase = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.recoveryDebtCase.findFirst({
        where: {
          userId: params.userId,
          currency: debt.currency,
          status: { in: ACTIVE_RECOVERY_DEBT_CASE_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        return tx.recoveryDebtCase.update({
          where: { id: existing.id },
          data: {
            status,
            amountMinor: debt.outstandingDebtMinor,
            currency: debt.currency,
            externalReference,
            note,
            openedByUserId: params.reviewerId,
            resolvedByUserId: null,
            resolvedAt: null,
          },
        });
      }

      return tx.recoveryDebtCase.create({
        data: {
          userId: params.userId,
          status,
          amountMinor: debt.outstandingDebtMinor,
          currency: debt.currency,
          externalReference,
          note,
          openedByUserId: params.reviewerId,
        },
      });
    }).catch((err: unknown) => {
      if (getErrorCode(err) === 'P2002') {
        throw new BadRequestException(
          'An active recovery debt case already exists for this user and currency. Reload and update the existing case.',
        );
      }
      throw err;
    });

    await this.audit.log({
      actorId: params.reviewerId,
      actorRole: params.reviewerRole ?? 'admin',
      action: 'recovery_debt_case_opened',
      targetType: 'recovery_debt_case',
      targetId: debtCase.id,
      afterSnap: {
        userId: params.userId,
        status,
        outstandingDebtMinor: debt.outstandingDebtMinor,
        currency: debt.currency,
        externalReference,
      },
    });

    return { case: debtCase, debt };
  }

  async resolveRecoveryDebtCase(params: {
    caseId: string;
    reviewerId: string;
    reviewerRole?: string;
    status: 'recovered' | 'written_off' | 'closed';
    externalReference?: string;
    note?: string;
  }) {
    const terminalStatus = toTerminalRecoveryDebtStatus(params.status);
    const note = sanitizeOptionalString(params.note);
    const externalReference = sanitizeOptionalString(params.externalReference);
    const now = new Date();

    const existing = await this.prisma.recoveryDebtCase.findUnique({
      where: { id: params.caseId },
    });
    if (!existing) throw new BadRequestException('Recovery debt case not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.recoveryDebtCase.updateMany({
        where: {
          id: params.caseId,
          status: { in: ACTIVE_RECOVERY_DEBT_CASE_STATUSES },
        },
        data: {
          status: terminalStatus,
          externalReference,
          note,
          resolvedByUserId: params.reviewerId,
          resolvedAt: now,
        },
      });
      if (claimed.count === 0) {
        const current = await tx.recoveryDebtCase.findUnique({
          where: { id: params.caseId },
          select: { status: true },
        });
        throw new BadRequestException(
          current
            ? `Recovery debt case cannot be resolved from status '${current.status}'`
            : 'Recovery debt case not found',
        );
      }
      return tx.recoveryDebtCase.findUnique({ where: { id: params.caseId } });
    });

    const debt = await this.getOutstandingRecoveryDebt(existing.userId, existing.currency);
    await this.audit.log({
      actorId: params.reviewerId,
      actorRole: params.reviewerRole ?? 'admin',
      action: 'recovery_debt_case_resolved',
      targetType: 'recovery_debt_case',
      targetId: params.caseId,
      beforeSnap: { status: existing.status, amountMinor: existing.amountMinor },
      afterSnap: {
        status: terminalStatus,
        userId: existing.userId,
        currentOutstandingDebtMinor: debt.outstandingDebtMinor,
        currency: debt.currency,
        externalReference,
      },
    });

    return { case: updated, debt };
  }

  private async getOutstandingRecoveryDebt(userId: string, currency = DEFAULT_RECOVERY_DEBT_CURRENCY) {
    const [confirmedDebits, confirmedCredits] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: { userId, currency, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, currency, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const confirmedDebitMinor = confirmedDebits._sum.amountMinor ?? 0;
    const confirmedCreditMinor = confirmedCredits._sum.amountMinor ?? 0;
    return {
      userId,
      currency,
      confirmedDebitMinor,
      confirmedCreditMinor,
      outstandingDebtMinor: Math.max(0, confirmedDebitMinor - confirmedCreditMinor),
    };
  }

  // ── Operational Metrics ──

  async getMetrics(days = 30) {
    const now = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prevPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);

    // Date-floor helper for grouping by day
    const floorDay = (d: Date): string => d.toISOString().slice(0, 10);

    // ── Daily impression trend ──
    const rawImpressions = await this.prisma.adImpression.findMany({
      where: { createdAt: { gte: periodStart } },
      select: { createdAt: true, isBillable: true },
    });
    const impressionByDay = new Map<string, { total: number; billable: number }>();
    for (const imp of rawImpressions) {
      const day = floorDay(imp.createdAt);
      const bucket = impressionByDay.get(day) ?? { total: 0, billable: 0 };
      bucket.total++;
      if (imp.isBillable) bucket.billable++;
      impressionByDay.set(day, bucket);
    }

    // ── Daily signup trend ──
    const rawSignups = await this.prisma.user.findMany({
      where: { createdAt: { gte: periodStart } },
      select: { createdAt: true, role: true },
    });
    const signupsByDay = new Map<string, { total: number; developer: number; advertiser: number }>();
    for (const u of rawSignups) {
      const day = floorDay(u.createdAt);
      const bucket = signupsByDay.get(day) ?? { total: 0, developer: 0, advertiser: 0 };
      bucket.total++;
      if (u.role === 'developer') bucket.developer++;
      if (u.role === 'advertiser') bucket.advertiser++;
      signupsByDay.set(day, bucket);
    }

    // ── Daily revenue/spend (from earnings ledger credits) ──
    const rawRevenue = await this.prisma.earningsLedger.findMany({
      where: { createdAt: { gte: periodStart }, entryType: 'credit' },
      select: { createdAt: true, amountMinor: true, status: true },
    });
    const revenueByDay = new Map<string, { estimated: number; confirmed: number; paid: number }>();
    for (const r of rawRevenue) {
      const day = floorDay(r.createdAt);
      const bucket = revenueByDay.get(day) ?? { estimated: 0, confirmed: 0, paid: 0 };
      if (r.status === 'estimated') bucket.estimated += r.amountMinor;
      else if (r.status === 'confirmed') bucket.confirmed += r.amountMinor;
      else if (r.status === 'paid') bucket.paid += r.amountMinor;
      revenueByDay.set(day, bucket);
    }

    // ── Daily advertiser spend ──
    const rawSpend = await this.prisma.advertiserLedger.findMany({
      where: { createdAt: { gte: periodStart }, entryType: 'debit' },
      select: { createdAt: true, amountMinor: true },
    });
    const spendByDay = new Map<string, number>();
    for (const s of rawSpend) {
      const day = floorDay(s.createdAt);
      spendByDay.set(day, (spendByDay.get(day) ?? 0) + s.amountMinor);
    }

    // ── Campaign status distribution ──
    const campaignByStatus = await this.prisma.campaign.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    // ── Active user counts (by role) ──
    const [devCount, advCount, adminCount] = await Promise.all([
      this.prisma.user.count({ where: { role: 'developer', status: 'active' } }),
      this.prisma.user.count({ where: { role: 'advertiser', status: 'active' } }),
      this.prisma.user.count({ where: { role: { in: ['admin', 'super_admin'] as const }, status: 'active' } }),
    ]);

    // ── Payout stats ──
    const [
      totalPayouts,
      pendingPayouts,
      payoutSum,
    ] = await Promise.all([
      this.prisma.payoutRequest.count(),
      this.prisma.payoutRequest.count({ where: { status: { in: ['requested', 'under_review'] } } }),
      this.prisma.earningsLedger.aggregate({ where: { status: 'paid', entryType: 'credit' }, _sum: { amountMinor: true } }),
    ]);

    // ── Fill in daily time-series (fill missing days with zeros) ──
    const daily: { date: string; impressions: number; billableImpressions: number; signups: number; developerSignups: number; advertiserSignups: number; estimatedRevenueMinor: number; confirmedRevenueMinor: number; paidRevenueMinor: number; advertiserSpendMinor: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dayStr = floorDay(d);
      const imps = impressionByDay.get(dayStr);
      const sigs = signupsByDay.get(dayStr);
      const rev = revenueByDay.get(dayStr);
      daily.push({
        date: dayStr,
        impressions: imps?.total ?? 0,
        billableImpressions: imps?.billable ?? 0,
        signups: sigs?.total ?? 0,
        developerSignups: sigs?.developer ?? 0,
        advertiserSignups: sigs?.advertiser ?? 0,
        estimatedRevenueMinor: rev?.estimated ?? 0,
        confirmedRevenueMinor: rev?.confirmed ?? 0,
        paidRevenueMinor: rev?.paid ?? 0,
        advertiserSpendMinor: spendByDay.get(dayStr) ?? 0,
      });
    }

    // ── Period-over-period comparison ──
    const [prevImpressions, prevSignups, prevRevenue] = await Promise.all([
      this.prisma.adImpression.count({ where: { createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      this.prisma.user.count({ where: { createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      this.prisma.earningsLedger.aggregate({ where: { createdAt: { gte: prevPeriodStart, lt: periodStart }, entryType: 'credit' }, _sum: { amountMinor: true } }),
    ]);

    const currentImpressions = rawImpressions.length;
    const currentSignups = rawSignups.length;
    const currentRevenue = rawRevenue.reduce((sum, r) => sum + r.amountMinor, 0);

    const calcPct = (current: number, prev: number): number | null =>
      prev > 0 ? Math.round(((current - prev) / prev) * 1000) / 10 : null;

    // ── Platform ledger breakdown ──
    const platform = await this.prisma.platformLedger.aggregate({
      _sum: { amountMinor: true },
      where: { bucket: 'platform_fee', entryType: 'credit' },
    });
    const reserve = await this.prisma.platformLedger.aggregate({
      _sum: { amountMinor: true },
      where: { bucket: 'fraud_reserve', entryType: 'credit' },
    });

    return {
      period: { days, from: floorDay(periodStart), to: floorDay(now) },
      daily,
      totals: {
        impressions: currentImpressions,
        billableImpressions: rawImpressions.filter((i) => i.isBillable).length,
        signups: currentSignups,
        estimatedRevenueMinor: rawRevenue.filter((r) => r.status === 'estimated').reduce((s, r) => s + r.amountMinor, 0),
        confirmedRevenueMinor: rawRevenue.filter((r) => r.status === 'confirmed').reduce((s, r) => s + r.amountMinor, 0),
        paidRevenueMinor: rawRevenue.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amountMinor, 0),
        advertiserSpendMinor: rawSpend.reduce((s, r) => s + r.amountMinor, 0),
      },
      vsPreviousPeriod: {
        impressionsChangePct: calcPct(currentImpressions, prevImpressions),
        signupsChangePct: calcPct(currentSignups, prevSignups),
        revenueChangePct: calcPct(currentRevenue, prevRevenue._sum.amountMinor ?? 0),
      },
      activeUsers: {
        developers: devCount,
        advertisers: advCount,
        admins: adminCount,
        total: devCount + advCount + adminCount,
      },
      campaigns: {
        byStatus: campaignByStatus.map((c) => ({ status: c.status, count: c._count._all })),
        total: campaignByStatus.reduce((s, c) => s + c._count._all, 0),
      },
      payouts: {
        total: totalPayouts,
        pending: pendingPayouts,
        totalPaidMinor: payoutSum._sum.amountMinor ?? 0,
      },
      platformRevenue: {
        platformFeeMinor: platform._sum.amountMinor ?? 0,
        fraudReserveMinor: reserve._sum.amountMinor ?? 0,
        totalMinor: (platform._sum.amountMinor ?? 0) + (reserve._sum.amountMinor ?? 0),
      },
    };
  }

  // ── Tool Integrations ──

  async getToolIntegrations() {
    return this.prisma.toolIntegration.findMany({
      orderBy: { slug: 'asc' },
    });
  }

  async toggleToolIntegration(slug: string, isActive: boolean) {
    const tool = await this.prisma.toolIntegration.findUnique({ where: { slug } });
    if (!tool) throw new BadRequestException(`Tool integration "${slug}" not found`);
    // CAS-gated: only succeeds if the current isActive matches what we read.
    // Concurrent toggles by another admin produce count===0 and a clear error.
    const result = await this.prisma.toolIntegration.updateMany({
      where: { slug, isActive: tool.isActive },
      data: { isActive },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        `Tool integration "${slug}" was just toggled by another admin. Reload to see the current state.`,
      );
    }
    return this.prisma.toolIntegration.findUnique({ where: { slug } });
  }

  // ── Webhooks ──

  async getWebhookEvents(params: { provider?: string; processingStatus?: string; page?: number; limit?: number }) {
    const where: Prisma.WebhookEventWhereInput = {};
    if (params.provider) where.provider = params.provider;
    if (params.processingStatus) where.processingStatus = params.processingStatus;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { events, total, page, limit };
  }

  // ── Archive Refunds ──

  /**
   * Confirm an archived campaign's refund obligation row after the admin has
   * manually issued the Stripe refund in the Stripe dashboard.
   *
   * The archive flow writes a `refund` row with `status: 'pending'` representing
   * the platform's obligation. This endpoint CAS-flips it to `confirmed`,
   * records the Stripe refund PI, and writes the matching platform `cash`
   * bucket debit so the books balance. Idempotent: an already-`confirmed` row
   * returns the existing row without re-writing the platform entry.
   */
  async confirmArchiveRefund(params: {
    entryId: string;
    stripeRefundPaymentIntentId: string;
  }) {
    const entry = await this.prisma.advertiserLedger.findUnique({
      where: { id: params.entryId },
    });
    if (!entry) throw new BadRequestException('Refund obligation entry not found');

    // Only archive-refund rows (idempotencyKey starts with `archive_refund_`), in
    // `pending` status, may be confirmed. Other rows or already-confirmed rows
    // are rejected with a clear error.
    if (!entry.idempotencyKey.startsWith('archive_refund_')) {
      throw new BadRequestException('This entry is not an archive refund obligation');
    }

    // Idempotent: already confirmed → return as-is (no re-write).
    if (entry.status === 'confirmed') {
      return { entry, confirmed: false, reason: 'already_confirmed' };
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // CAS flip from pending → confirmed. Only at most one admin succeeds;
      // a concurrent call sees count === 0 and the outer `already confirmed`
      // fast-path catches it.
      const claimed = await tx.advertiserLedger.updateMany({
        where: { id: params.entryId, status: 'pending' },
        data: {
          status: 'confirmed',
          stripePaymentIntentId: params.stripeRefundPaymentIntentId,
        },
      });
      if (claimed.count === 0) return;

      // Platform cash side: debit the `cash` bucket by the refund amount
      // so the books reflect the outbound cash (mirroring the inbound
      // `payment_intent` credit written by the Stripe webhook). Keyed on
      // the refund PI so a re-delivery is a P2002 no-op.
      try {
        await tx.platformLedger.create({
          data: {
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: entry.amountMinor,
            currency: entry.currency,
            bucket: 'cash',
            referenceId: params.stripeRefundPaymentIntentId,
            idempotencyKey: `archive_refund_plat_${params.entryId}`,
            description: `Archive refund confirmed — Stripe refund ${params.stripeRefundPaymentIntentId}`,
          },
        });
      } catch (err: unknown) {
        // P2002 = already wrote the platform entry via a concurrent call.
        // The CAS above ensures only one admin's call writes the row; the
        // tangent path is the same admin re-calling this endpoint.
        if (getErrorCode(err) !== 'P2002') throw err;
      }
    });

    const confirmed = await this.prisma.advertiserLedger.findUnique({
      where: { id: params.entryId },
    });
    return { entry: confirmed, confirmed: true };
  }
}

function hashDeviceRecoveryToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function sanitizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeOptionalCurrency(value: string | undefined): string | undefined {
  const currency = value?.trim().toUpperCase();
  if (!currency) return undefined;
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException('currency must be a 3-letter ISO currency code');
  }
  return currency;
}

function recoveryDebtCaseKey(userId: string, currency: string): string {
  return `${userId}:${currency}`;
}

function toTerminalRecoveryDebtStatus(status: 'recovered' | 'written_off' | 'closed'): RecoveryDebtCaseStatus {
  switch (status) {
    case 'recovered':
      return RecoveryDebtCaseStatus.recovered;
    case 'written_off':
      return RecoveryDebtCaseStatus.written_off;
    case 'closed':
      return RecoveryDebtCaseStatus.closed;
  }
}
