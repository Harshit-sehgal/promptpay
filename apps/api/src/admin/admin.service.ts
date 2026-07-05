import { Injectable, BadRequestException } from '@nestjs/common';
import { FraudFlagStatus, FraudSeverity, Prisma, UserRole, UserStatus } from '@waitlayer/db';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PayoutService } from '../payout/payout.service';
import { FraudService } from '../fraud/fraud.service';

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
    const result = await this.prisma.payoutRequest.updateMany({
      where: { id: payoutId, status: { in: ['requested', 'under_review', 'approved'] } },
      data: { status: 'rejected', reviewerId, reviewNote: reason },
    });
    if (result.count === 0) {
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

  async getFraudFlags(params: { status?: string; severity?: string }) {
    const where: Prisma.FraudFlagWhereInput = {};
    if (params.status) where.status = params.status as FraudFlagStatus;
    if (params.severity) where.severity = params.severity as FraudSeverity;
    return this.prisma.fraudFlag.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
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
        if ((err as any)?.code !== 'P2002') throw err;
      }
    });

    const confirmed = await this.prisma.advertiserLedger.findUnique({
      where: { id: params.entryId },
    });
    return { entry: confirmed, confirmed: true };
  }
}
