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
      this.prisma.earningsLedger.aggregate({ where: { status: 'paid' }, _sum: { amountMinor: true } }),
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

    const [updatedCampaign] = await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: newStatus, approvedAt: new Date(), activatedAt: canActivate ? new Date() : null },
      }),
      this.prisma.campaignApproval.create({ data: { campaignId, reviewerId, decision: 'approved', reason } }),
    ]);

    return {
      campaign: updatedCampaign,
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
    return this.prisma.$transaction([
      this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'rejected' } }),
      this.prisma.campaignApproval.create({ data: { campaignId, reviewerId, decision: 'rejected', reason } }),
    ]);
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

    // Read the payout to validate a partial-approval amount against the
    // requested amount BEFORE the conditional update. The conditional update
    // below is the authoritative state guard; this read is just the bounds
    // check (a TOCTOU between this read and the update cannot inflate the
    // approved amount because requestedAmountMinor is immutable post-request
    // — see PayoutRequest schema).
    let resolvedApprovedAmount: number | undefined;
    if (approvedAmountMinor !== undefined) {
      const target = await this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        select: { requestedAmountMinor: true, currency: true, status: true },
      });
      if (!target) throw new BadRequestException('Payout not found');
      if (approvedAmountMinor > target.requestedAmountMinor) {
        throw new BadRequestException(
          `approvedAmountMinor (${approvedAmountMinor}) cannot exceed requestedAmountMinor (${target.requestedAmountMinor})`,
        );
      }
      resolvedApprovedAmount = approvedAmountMinor;
    }

    const result = await this.prisma.payoutRequest.updateMany({
      where: { id: payoutId, status: { in: ['requested', 'under_review'] } },
      data: {
        status: 'approved',
        reviewerId,
        reviewNote: note,
        processedAt: new Date(),
        // Always set: explicit full-approval when no partial amount given,
        // the validated partial amount otherwise. This neutralises the
        // silent-null-fallback footgun downstream.
        approvedAmountMinor: resolvedApprovedAmount ?? undefined,
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

    // When full approval was requested, fetch the requested amount and set
    // the column in a second (idempotent) write. We can't do this in the
    // updateMany above because we don't have the requested amount there
    // without an extra read; doing the read + conditional write here keeps
    // the happy path at one round-trip for partial approvals.
    if (approvedAmountMinor === undefined) {
      const full = await this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        select: { requestedAmountMinor: true },
      });
      if (full) {
        await this.prisma.payoutRequest.update({
          where: { id: payoutId },
          data: { approvedAmountMinor: full.requestedAmountMinor },
        });
      }
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
    return this.prisma.toolIntegration.update({
      where: { slug },
      data: { isActive },
    });
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
}
