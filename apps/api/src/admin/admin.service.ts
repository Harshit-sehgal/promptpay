import * as crypto from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';

import {
  CampaignStatus,
  FraudFlagStatus,
  FraudSeverity,
  Prisma,
  RecoveryDebtCaseStatus,
  ToolTypeEnum,
  UserRole,
  UserStatus,
} from '@waitlayer/db';
import { isSupportedCurrency } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { getErrorCode } from '../common/utils/errors';
import { PrismaService } from '../config/prisma.service';
import { DeveloperService } from '../developer/developer.service';
import { FraudService } from '../fraud/fraud.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { PayoutService } from '../payout/payout.service';

const DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES = 15;
const MAX_DEVICE_RECOVERY_TOKEN_MINUTES = 60;
const DEFAULT_RECOVERY_DEBT_CURRENCY = 'USD';
const ACTIVE_RECOVERY_DEBT_CASE_STATUSES = [
  RecoveryDebtCaseStatus.open,
  RecoveryDebtCaseStatus.in_collections,
];

type CurrencyAmountGroup = { currency: string; _sum: { amountMinor: number | null } };

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private payoutService: PayoutService,
    private fraudService: FraudService,
    private developerService: DeveloperService,
  ) {}

  async getOverview() {
    const [users, campaigns, impressions, payouts, fraudFlags] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.campaign.count({ where: { status: 'active' } }),
      this.prisma.adImpression.count({ where: { isBillable: true } }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { status: 'paid', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.fraudFlag.count({ where: { status: 'open' } }),
    ]);
    const totalPayoutsByCurrency = Object.fromEntries(
      payouts.map((row) => [row.currency, row._sum.amountMinor ?? 0]),
    );
    return {
      activeUsers: users,
      activeCampaigns: campaigns,
      totalBillableImpressions: impressions,
      totalPayoutsMinor: totalPayoutsByCurrency.USD ?? 0,
      totalPayoutsByCurrency,
      openFraudFlags: fraudFlags,
    };
  }

  async getMoneyIntegrityReport() {
    // 1. Campaign Spend vs Advertiser Debits
    const advertiserDebits = await this.prisma.advertiserLedger.groupBy({
      by: ['campaignId', 'currency'],
      where: { entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      _sum: { amountMinor: true },
    });
    const debitMap = new Map(
      advertiserDebits.map((d) => [`${d.campaignId}:${d.currency}`, d._sum.amountMinor ?? 0]),
    );
    const debitCampaignIds = [
      ...new Set(
        advertiserDebits.map((d) => d.campaignId).filter((id): id is string => id !== null),
      ),
    ];

    // Bounded: only load campaigns that could be discrepant (recorded spend or a
    // matching ledger debit) instead of scanning the entire campaign table.
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        OR: [{ budgetSpentMinor: { not: 0 } }, { id: { in: debitCampaignIds } }],
      },
      select: { id: true, name: true, budgetSpentMinor: true, currency: true },
    });

    const campaignDiscrepancies: Array<{
      campaignId: string;
      campaignName: string;
      budgetSpentMinor: number;
      ledgerDebits: number;
      diff: number;
      currency: string;
    }> = [];
    for (const c of campaigns) {
      const debits = debitMap.get(`${c.id}:${c.currency}`) ?? 0;
      if (c.budgetSpentMinor !== debits) {
        campaignDiscrepancies.push({
          campaignId: c.id,
          campaignName: c.name,
          budgetSpentMinor: c.budgetSpentMinor,
          ledgerDebits: debits,
          diff: c.budgetSpentMinor - debits,
          currency: c.currency,
        });
      }
    }

    // 2. Global Split Reconciliation
    const [
      totalEarningsCredit,
      totalEarningsDebit,
      totalAdvertiserDebit,
      totalAdvertiserRefund,
      totalPlatformCredit,
      totalPlatformReversal,
      totalReserveCredit,
      totalReserveReversal,
    ] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: {
          entryType: 'credit',
          status: { in: ['estimated', 'pending', 'confirmed', 'held', 'paid'] },
        },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit', status: 'confirmed' },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'refund', status: { in: ['confirmed', 'paid'] } },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.PLATFORM_FEE, status: 'confirmed' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: {
          entryType: 'reversal',
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          status: 'confirmed',
        },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE, status: 'confirmed' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: {
          entryType: 'reversal',
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          status: 'confirmed',
        },
      }),
    ]);

    const netEarningsByCurrency = netCurrencyAmounts(totalEarningsCredit, totalEarningsDebit);
    const netAdvertiserByCurrency = netCurrencyAmounts(totalAdvertiserDebit, totalAdvertiserRefund);
    const netPlatformByCurrency = netCurrencyAmounts(totalPlatformCredit, totalPlatformReversal);
    const netReserveByCurrency = netCurrencyAmounts(totalReserveCredit, totalReserveReversal);

    const currencies = new Set([
      ...Object.keys(netEarningsByCurrency),
      ...Object.keys(netAdvertiserByCurrency),
      ...Object.keys(netPlatformByCurrency),
      ...Object.keys(netReserveByCurrency),
    ]);
    const globalReconciliationByCurrency = Object.fromEntries(
      Array.from(currencies)
        .sort()
        .map((currency) => {
          const netEarnings = netEarningsByCurrency[currency] ?? 0;
          const netAdvertiser = netAdvertiserByCurrency[currency] ?? 0;
          const netPlatform = netPlatformByCurrency[currency] ?? 0;
          const netReserve = netReserveByCurrency[currency] ?? 0;
          const splitSum = netEarnings + netPlatform + netReserve;
          return [
            currency,
            {
              netAdvertiserSpendMinor: netAdvertiser,
              netDeveloperEarningsMinor: netEarnings,
              netPlatformFeeMinor: netPlatform,
              netReserveMinor: netReserve,
              splitSumMinor: splitSum,
              discrepancyMinor: netAdvertiser - splitSum,
            },
          ];
        }),
    );
    const usdGlobal = globalReconciliationByCurrency.USD ?? {
      netAdvertiserSpendMinor: 0,
      netDeveloperEarningsMinor: 0,
      netPlatformFeeMinor: 0,
      netReserveMinor: 0,
      splitSumMinor: 0,
      discrepancyMinor: 0,
    };
    const globalDiscrepancy = Object.values(globalReconciliationByCurrency).some(
      (row) => row.discrepancyMinor !== 0,
    );

    // 3. Developer Negative Balances (bounded: aggregate earnings by
    //    user+currency, then fetch emails only for users with a negative balance
    //    instead of loading every developer row first).
    const [developerCreditGroups, developerDebitGroups] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const developerBalances = new Map<string, number>();
    for (const row of developerCreditGroups) {
      const key = `${row.userId}:${row.currency}`;
      developerBalances.set(key, (developerBalances.get(key) ?? 0) + (row._sum.amountMinor ?? 0));
    }
    for (const row of developerDebitGroups) {
      const key = `${row.userId}:${row.currency}`;
      developerBalances.set(key, (developerBalances.get(key) ?? 0) - (row._sum.amountMinor ?? 0));
    }
    const negativeDeveloperBalances: Array<{
      userId: string;
      email: string;
      balanceMinor: number;
      currency: string;
    }> = [];
    const negativeUserIds: string[] = [];
    for (const [key, balance] of developerBalances) {
      if (balance < 0) {
        const [userId, currency] = key.split(':');
        negativeDeveloperBalances.push({ userId, email: userId, balanceMinor: balance, currency });
        negativeUserIds.push(userId);
      }
    }
    if (negativeUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: negativeUserIds } },
        select: { id: true, email: true },
      });
      const emailById = new Map(users.map((u) => [u.id, u.email]));
      for (const row of negativeDeveloperBalances) {
        row.email = emailById.get(row.userId) ?? row.userId;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      status:
        campaignDiscrepancies.length === 0 &&
        !globalDiscrepancy &&
        negativeDeveloperBalances.length === 0
          ? 'healthy'
          : 'unhealthy',
      globalReconciliation: {
        netAdvertiserSpendMinor: usdGlobal.netAdvertiserSpendMinor,
        netDeveloperEarningsMinor: usdGlobal.netDeveloperEarningsMinor,
        netPlatformFeeMinor: usdGlobal.netPlatformFeeMinor,
        netReserveMinor: usdGlobal.netReserveMinor,
        splitSumMinor: usdGlobal.splitSumMinor,
        discrepancyMinor: usdGlobal.discrepancyMinor,
      },
      globalReconciliationByCurrency,
      campaignDiscrepancies,
      negativeDeveloperBalances,
    };
  }

  async getUsers(params: { status?: string; role?: string; search?: string }) {
    const where: Prisma.UserWhereInput = {};
    if (params.status) where.status = params.status as UserStatus;
    if (params.role) where.role = params.role as UserRole;
    if (params.search)
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { name: { contains: params.search, mode: 'insensitive' } },
      ];
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        trustLevel: true,
        country: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Attach the open fraud-flag count per user so the admin ops view can triage
    // accounts with active flags without a separate round-trip per row.
    const openFlags = await this.prisma.fraudFlag.groupBy({
      by: ['userId'],
      where: { status: 'open', userId: { in: users.map((u) => u.id) } },
      _count: { _all: true },
    });
    const openFlagsByUser = new Map(openFlags.map((f) => [f.userId, f._count._all]));

    return users.map((u) => ({ ...u, openFlags: openFlagsByUser.get(u.id) ?? 0 }));
  }

  /**
   * Admin-initiated account erasure (right-to-be-forgotten / ToS termination).
   * Reuses the developer self-deletion path (anonymize PII, revoke sessions &
   * API keys) but logs the action under the admin actor so the forensic trail
   * is separate from the (now-anonymized) subject row.
   */
  async eraseUser(actorId: string, actorRole: string, targetUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.role === 'super_admin') {
      throw new BadRequestException('Cannot erase a super-admin account');
    }
    await this.developerService.deleteAccount(targetUserId, {
      auditActor: {
        actorId,
        actorRole,
        action: 'admin_erased_user',
      },
    });
    return { erased: true, userId: targetUserId };
  }

  /**
   * Admin-initiated account status change (ban / restrict / unban). Used by the
   * admin users UI for account-lifecycle operations. Erasing stays a separate,
   * explicitly-confirmed path (eraseUser) because it is irreversible.
   */
  private static readonly ALLOWED_ADMIN_STATUSES: UserStatus[] = ['active', 'restricted', 'banned'];

  async setUserStatus(actorId: string, actorRole: string, targetUserId: string, status: string) {
    if (!AdminService.ALLOWED_ADMIN_STATUSES.includes(status as UserStatus)) {
      throw new BadRequestException(`Invalid target status: ${status}`);
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.role === 'super_admin') {
      throw new BadRequestException('Cannot change the status of a super-admin account');
    }
    if (target.status === status) {
      return target;
    }
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: status as UserStatus },
    });
    await this.audit.log({
      actorId,
      actorRole,
      action: 'admin_set_user_status',
      targetType: 'user',
      targetId: targetUserId,
      beforeSnap: { status: target.status },
      afterSnap: { status },
    });
    return updated;
  }

  async getPendingCampaigns(
    query: { page?: number; limit?: number; status?: 'submitted' | 'approved' } = {},
  ) {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)));
    const where = query.status
      ? { status: query.status }
      : { status: { in: ['submitted', 'approved'] as CampaignStatus[] } };
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: { advertiser: { select: { companyName: true } }, creatives: true },
        orderBy: { submittedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async approveCampaign(campaignId: string, reviewerId: string, reason?: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { creatives: true },
    });
    if (!campaign || campaign.status !== 'submitted') {
      throw new BadRequestException('Campaign must be in submitted status to approve');
    }

    // Must have at least one approved creative, remaining budget, and funded
    // advertiser balance to activate. The serving path enforces the same
    // balance floor, so approval must not label an unfunded campaign active.
    const hasApprovedCreative = campaign.creatives.some((c) => c.status === 'approved');
    const hasBudget = campaign.budgetSpentMinor < campaign.budgetTotalMinor;
    const advertiserBalance = await getAdvertiserBalance(
      this.prisma,
      campaign.advertiserId,
      campaign.currency,
    );
    const hasFundedBalance = advertiserBalance > 0;
    const canActivate = hasApprovedCreative && hasBudget && hasFundedBalance;

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
    if (!hasFundedBalance) {
      blockers.push('Advertiser has no funded balance. Deposit funds before activation.');
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
    return this.prisma.payoutRequest.findMany({
      where: { status: { in: ['requested', 'under_review', 'approved', 'processing'] } },
      include: {
        user: { select: { email: true, name: true, trustLevel: true } },
        payoutAccount: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
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
      const existing = await this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        select: { status: true },
      });
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
      const existing = await this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        select: { status: true },
      });
      throw new BadRequestException(
        existing
          ? `Payout cannot be rejected from status '${existing.status}'`
          : 'Payout not found',
      );
    }
    return this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
  }

  async processPayout(payoutId: string) {
    return this.payoutService.processPayout(payoutId);
  }

  async markPayoutPaid(
    payoutId: string,
    data: { providerTxId: string; paidAt: string; amountMinor: number; currency: string },
  ) {
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
      const statuses = params.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
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
    const [byStatus, bySeverity, byFlagType, total, resolved7d, resolvedFlags] = await Promise.all([
      Promise.all(
        (
          [
            'open',
            'reviewing',
            'resolved_valid',
            'resolved_invalid',
            'escalated',
          ] as FraudFlagStatus[]
        ).map((status) => this.prisma.fraudFlag.count({ where: { status } })),
      ),
      Promise.all(
        (['critical', 'high', 'medium', 'low'] as FraudSeverity[]).map((severity) =>
          this.prisma.fraudFlag.count({
            where: { severity, status: { in: ['open', 'reviewing'] as FraudFlagStatus[] } },
          }),
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
    const escalationRate =
      totalResolved > 0 ? Math.round((resolvedValid / totalResolved) * 100) : 0;

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

  async getAuditLog(params: {
    actorId?: string;
    actorRole?: string;
    targetType?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    return this.audit.query(params);
  }

  // ── Device Recovery ──

  async getDevices(params: {
    search?: string;
    userId?: string;
    toolType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const skip = (page - 1) * limit;
    const search = params.search?.trim();
    const toolType = normalizeOptionalToolType(params.toolType);

    const filters: Prisma.DeviceWhereInput[] = [];
    if (params.userId) filters.push({ userId: params.userId });
    if (toolType) filters.push({ toolType });
    if (search) {
      const searchToolType = normalizeOptionalToolType(search, false);
      filters.push({
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          { userId: { contains: search, mode: 'insensitive' } },
          { fingerprintHash: { contains: search, mode: 'insensitive' } },
          { platform: { contains: search, mode: 'insensitive' } },
          { extensionVersion: { contains: search, mode: 'insensitive' } },
          { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
          { user: { is: { name: { contains: search, mode: 'insensitive' } } } },
          ...(searchToolType ? [{ toolType: searchToolType }] : []),
        ],
      });
    }

    const where: Prisma.DeviceWhereInput = filters.length > 0 ? { AND: filters } : {};
    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          userId: true,
          fingerprintHash: true,
          eventSecret: true,
          toolType: true,
          extensionVersion: true,
          platform: true,
          createdAt: true,
          lastSeenAt: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              status: true,
            },
          },
          recoveryTokens: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              reason: true,
              expiresAt: true,
              usedAt: true,
              revokedAt: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.device.count({ where }),
    ]);

    return {
      devices: devices.map((device) => ({
        id: device.id,
        userId: device.userId,
        fingerprintHash: device.fingerprintHash,
        hasEventSecret: Boolean(device.eventSecret),
        toolType: device.toolType,
        extensionVersion: device.extensionVersion,
        platform: device.platform,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        user: device.user,
        latestRecoveryToken: device.recoveryTokens[0] ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async issueDeviceRecoveryToken(params: {
    deviceId: string;
    userId: string;
    reviewerId: string;
    reviewerRole?: string;
    reason?: string;
    expiresInMinutes?: number;
  }) {
    const expiresInMinutes = params.expiresInMinutes ?? DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES;
    if (
      !Number.isInteger(expiresInMinutes) ||
      expiresInMinutes < 5 ||
      expiresInMinutes > MAX_DEVICE_RECOVERY_TOKEN_MINUTES
    ) {
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
      throw new BadRequestException(
        'Legacy devices without a per-device secret can re-register without a support token',
      );
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

  async getRecoveryDebtCases(params: {
    page?: number;
    limit?: number;
    minAmountMinor?: number;
    currency?: string;
  }) {
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
      creditByUserCurrency.set(`${credit.userId}:${credit.currency}`, credit._sum.amountMinor ?? 0);
    }

    const allDebtRows = debitGroups
      .map((debit) => {
        const debitMinor = debit._sum.amountMinor ?? 0;
        const confirmedCreditMinor =
          creditByUserCurrency.get(`${debit.userId}:${debit.currency}`) ?? 0;
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
      .sort(
        (a, b) =>
          b.outstandingDebtMinor - a.outstandingDebtMinor || a.userId.localeCompare(b.userId),
      );

    const total = allDebtRows.length;
    const rows = allDebtRows.slice((page - 1) * limit, page * limit);
    const userIds = Array.from(new Set(rows.map((row) => row.userId)));
    const currencies = Array.from(new Set(rows.map((row) => row.currency)));
    const [users, cases] =
      userIds.length > 0
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
        latestCase:
          latestCaseByUserCurrency.get(recoveryDebtCaseKey(row.userId, row.currency)) ?? null,
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
      throw new BadRequestException(
        'Recovery debt cases can only be opened for developer accounts',
      );
    }

    const requestedCurrency =
      normalizeOptionalCurrency(params.currency) ?? DEFAULT_RECOVERY_DEBT_CURRENCY;
    const debt = await this.getOutstandingRecoveryDebt(params.userId, requestedCurrency);
    if (debt.outstandingDebtMinor <= 0) {
      throw new BadRequestException('User has no outstanding recovery debt');
    }

    // Minimum-amount gate: don't open a collection case (with all its
    // operational overhead) for a trivial outstanding balance. Below this
    // threshold the debt is immaterial and not worth pursuing.
    const MIN_RECOVERY_DEBT_CASE_MINOR = 100; // $1.00
    if (debt.outstandingDebtMinor < MIN_RECOVERY_DEBT_CASE_MINOR) {
      throw new BadRequestException(
        `Outstanding recovery debt (${debt.outstandingDebtMinor} minor) is below the minimum threshold for opening a case`,
      );
    }

    const status =
      params.status === 'in_collections'
        ? RecoveryDebtCaseStatus.in_collections
        : RecoveryDebtCaseStatus.open;
    const note = sanitizeOptionalString(params.note);
    const externalReference = sanitizeOptionalString(params.externalReference);

    const debtCase = await this.prisma
      .$transaction(async (tx) => {
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
      })
      .catch((err: unknown) => {
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

  private async getOutstandingRecoveryDebt(
    userId: string,
    currency = DEFAULT_RECOVERY_DEBT_CURRENCY,
  ) {
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

  async getMetrics(days = 30, currency = 'USD') {
    // A-007 / multi-currency fix: the platform is multi-currency
    // (A-081). Metrics were previously hard-filtered to USD, which
    // silently excluded ALL non-USD revenue/spend. The reporting
    // currency is now a parameter (default USD for backward
    // compatibility) so any currency is queryable and nothing is
    // dropped. Reject anything that is not a supported currency.
    const reportingCurrency = isSupportedCurrency(currency) ? currency.toUpperCase() : 'USD';
    const now = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prevPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);

    // Date-floor helper for grouping by day
    const floorDay = (d: Date): string => d.toISOString().slice(0, 10);

    // A-007: All daily aggregation is computed in the DATABASE via SQL
    // date_trunc instead of loading raw event rows into Node.js memory.
    // This ensures bounded memory usage for the admin dashboard even with
    // high event volume over long date ranges. The pattern matches A-068.

    // ── Daily impression trend (database aggregated) ──
    const dailyImpressions = await this.prisma.$queryRaw<
      { day: Date; total: bigint; billable: bigint }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "isBillable")::int AS billable
      FROM ad_impressions
      WHERE "createdAt" >= ${periodStart}
      GROUP BY day
      ORDER BY day
    `;
    const impressionByDay = new Map<string, { total: number; billable: number }>();
    let totalImpressions = 0;
    let totalBillable = 0;
    for (const imp of dailyImpressions) {
      const dayStr = imp.day.toISOString().slice(0, 10);
      const total = Number(imp.total);
      const billable = Number(imp.billable);
      impressionByDay.set(dayStr, { total, billable });
      totalImpressions += total;
      totalBillable += billable;
    }

    // ── Daily signup trend (database aggregated) ──
    const dailySignups = await this.prisma.$queryRaw<
      { day: Date; total: bigint; developer: bigint; advertiser: bigint }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "role" = 'developer')::int AS developer,
             COUNT(*) FILTER (WHERE "role" = 'advertiser')::int AS advertiser
      FROM users
      WHERE "createdAt" >= ${periodStart}
      GROUP BY day
      ORDER BY day
    `;
    const signupsByDay = new Map<
      string,
      { total: number; developer: number; advertiser: number }
    >();
    let totalSignups = 0;
    for (const sig of dailySignups) {
      const dayStr = sig.day.toISOString().slice(0, 10);
      const entry = {
        total: Number(sig.total),
        developer: Number(sig.developer),
        advertiser: Number(sig.advertiser),
      };
      signupsByDay.set(dayStr, entry);
      totalSignups += entry.total;
    }

    // ── Daily revenue from earnings ledger credits (database aggregated) ──
    const dailyRevenue = await this.prisma.$queryRaw<
      { day: Date; estimated: bigint; confirmed: bigint; paid: bigint; total: bigint }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
              COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'estimated'), 0)::bigint AS estimated,
              COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'confirmed'), 0)::bigint AS confirmed,
              COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'paid'), 0)::bigint AS paid,
              COALESCE(SUM("amountMinor"), 0)::bigint AS total
      FROM earnings_ledger
      WHERE "createdAt" >= ${periodStart}
        AND "entryType" = 'credit'
        AND "currency" = ${reportingCurrency}
      GROUP BY day
      ORDER BY day
    `;
    const revenueByDay = new Map<string, { estimated: number; confirmed: number; paid: number }>();
    let totalEstimatedRevenue = 0;
    let totalConfirmedRevenue = 0;
    let totalPaidRevenue = 0;
    let totalRevenueAmount = 0;
    for (const rev of dailyRevenue) {
      const dayStr = rev.day.toISOString().slice(0, 10);
      const estimated = Number(rev.estimated);
      const confirmed = Number(rev.confirmed);
      const paid = Number(rev.paid);
      const total = Number(rev.total);
      revenueByDay.set(dayStr, { estimated, confirmed, paid });
      totalEstimatedRevenue += estimated;
      totalConfirmedRevenue += confirmed;
      totalPaidRevenue += paid;
      totalRevenueAmount += total;
    }

    // ── Daily advertiser spend (database aggregated) ──
    const dailySpend = await this.prisma.$queryRaw<{ day: Date; spend: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day,
              COALESCE(SUM("amountMinor"), 0)::bigint AS spend
      FROM advertiser_ledger
      WHERE "createdAt" >= ${periodStart}
        AND "entryType" = 'debit'
        AND "currency" = ${reportingCurrency}
      GROUP BY day
      ORDER BY day
    `;
    const spendByDay = new Map<string, number>();
    let totalAdvertiserSpend = 0;
    for (const row of dailySpend) {
      const dayStr = row.day.toISOString().slice(0, 10);
      const spend = Number(row.spend);
      spendByDay.set(dayStr, spend);
      totalAdvertiserSpend += spend;
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
      this.prisma.user.count({
        where: { role: { in: ['admin', 'super_admin'] as const }, status: 'active' },
      }),
    ]);

    // ── Payout stats ──
    const [totalPayouts, pendingPayouts, payoutSum] = await Promise.all([
      this.prisma.payoutRequest.count(),
      this.prisma.payoutRequest.count({ where: { status: { in: ['requested', 'under_review'] } } }),
      this.prisma.earningsLedger.aggregate({
        where: { status: 'paid', entryType: 'credit', currency: reportingCurrency },
        _sum: { amountMinor: true },
      }),
    ]);

    // ── Fill in daily time-series (fill missing days with zeros) ──
    const daily: {
      date: string;
      impressions: number;
      billableImpressions: number;
      signups: number;
      developerSignups: number;
      advertiserSignups: number;
      estimatedRevenueMinor: number;
      confirmedRevenueMinor: number;
      paidRevenueMinor: number;
      advertiserSpendMinor: number;
    }[] = [];
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
      this.prisma.adImpression.count({
        where: { createdAt: { gte: prevPeriodStart, lt: periodStart } },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      this.prisma.earningsLedger.aggregate({
        where: {
          createdAt: { gte: prevPeriodStart, lt: periodStart },
          entryType: 'credit',
          currency: reportingCurrency,
        },
        _sum: { amountMinor: true },
      }),
    ]);

    // A-007: totals now computed from the database-aggregated data instead of
    // from raw arrays that were previously loaded into Node.js memory.
    const currentImpressions = totalImpressions;
    const currentSignups = totalSignups;
    const currentRevenue = totalRevenueAmount;

    const calcPct = (current: number, prev: number): number | null =>
      prev > 0 ? Math.round(((current - prev) / prev) * 1000) / 10 : null;

    // ── Platform ledger breakdown ──
    // Reported in the selected `reportingCurrency` so platform
    // fees / fraud reserves in non-USD buckets are not dropped.
    const platform = await this.prisma.platformLedger.aggregate({
      _sum: { amountMinor: true },
      where: { bucket: 'platform_fee', entryType: 'credit', currency: reportingCurrency },
    });
    const reserve = await this.prisma.platformLedger.aggregate({
      _sum: { amountMinor: true },
      where: { bucket: 'fraud_reserve', entryType: 'credit', currency: reportingCurrency },
    });

    return {
      currency: reportingCurrency,
      period: { days, from: floorDay(periodStart), to: floorDay(now) },
      daily,
      totals: {
        impressions: currentImpressions,
        billableImpressions: totalBillable,
        signups: currentSignups,
        estimatedRevenueMinor: totalEstimatedRevenue,
        confirmedRevenueMinor: totalConfirmedRevenue,
        paidRevenueMinor: totalPaidRevenue,
        advertiserSpendMinor: totalAdvertiserSpend,
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

  async getWebhookEvents(params: {
    provider?: string;
    processingStatus?: string;
    page?: number;
    limit?: number;
  }) {
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

  // ── Payout account verification ──

  /**
   * Verify or reject a developer's payout destination before it can be used to
   * move money. Payout requests to unverified accounts are rejected by
   * PayoutService, so this is the operator-side gate that unlocks them. Both
   * actions are audited and scoped to admin/support roles upstream.
   */
  async setPayoutAccountVerified(
    reviewerId: string,
    reviewerRole: string,
    payoutAccountId: string,
    verified: boolean,
    reason?: string,
  ) {
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!account) throw new BadRequestException('Payout account not found');

    const updated = await this.prisma.payoutAccount.update({
      where: { id: payoutAccountId },
      data: { isVerified: verified },
    });

    await this.audit.log({
      actorId: reviewerId,
      actorRole: reviewerRole,
      action: verified ? 'payout_account_verified' : 'payout_account_rejected',
      targetType: 'payout_account',
      targetId: payoutAccountId,
      beforeSnap: { isVerified: account.isVerified },
      afterSnap: {
        isVerified: verified,
        provider: account.provider,
        destination: account.destination,
        userEmail: account.user?.email,
        reason: reason ?? null,
      },
    });

    return updated;
  }

  // ── Archive Refunds ──

  async getPendingArchiveRefunds() {
    return this.prisma.advertiserLedger.findMany({
      where: {
        entryType: 'refund',
        status: 'pending',
        idempotencyKey: { startsWith: 'archive_refund_' },
      },
      include: {
        advertiser: {
          select: {
            id: true,
            companyName: true,
            billingEmail: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            archivedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

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
  async confirmArchiveRefund(params: { entryId: string; stripeRefundPaymentIntentId: string }) {
    const stripeRefundPaymentIntentId = params.stripeRefundPaymentIntentId.trim();
    if (!stripeRefundPaymentIntentId) {
      throw new BadRequestException('stripeRefundPaymentIntentId is required');
    }

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
          stripePaymentIntentId: stripeRefundPaymentIntentId,
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
            referenceId: stripeRefundPaymentIntentId,
            idempotencyKey: `archive_refund_plat_${params.entryId}`,
            description: `Archive refund confirmed — Stripe refund ${stripeRefundPaymentIntentId}`,
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

function normalizeOptionalToolType(
  toolType?: string,
  throwOnInvalid = true,
): ToolTypeEnum | undefined {
  const normalized = toolType?.trim();
  if (!normalized) return undefined;
  if ((Object.values(ToolTypeEnum) as string[]).includes(normalized)) {
    return normalized as ToolTypeEnum;
  }
  if (!throwOnInvalid) return undefined;
  throw new BadRequestException(`Unsupported toolType '${normalized}'`);
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

function netCurrencyAmounts(
  credits: CurrencyAmountGroup[],
  debits: CurrencyAmountGroup[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of credits) {
    totals[row.currency] = (totals[row.currency] ?? 0) + (row._sum.amountMinor ?? 0);
  }
  for (const row of debits) {
    totals[row.currency] = (totals[row.currency] ?? 0) - (row._sum.amountMinor ?? 0);
  }
  return totals;
}

function recoveryDebtCaseKey(userId: string, currency: string): string {
  return `${userId}:${currency}`;
}

function toTerminalRecoveryDebtStatus(
  status: 'recovered' | 'written_off' | 'closed',
): RecoveryDebtCaseStatus {
  switch (status) {
    case 'recovered':
      return RecoveryDebtCaseStatus.recovered;
    case 'written_off':
      return RecoveryDebtCaseStatus.written_off;
    case 'closed':
      return RecoveryDebtCaseStatus.closed;
  }
}
