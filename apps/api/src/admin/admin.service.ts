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

  async approvePayout(payoutId: string, reviewerId: string, note?: string) {
    // Conditional update: only approve from a reviewable state. This prevents
    // an admin (or a compromised admin token) from re-approving a payout that
    // is already `paid`/`processing` (destroying the payment audit trail) or
    // resurrecting a `rejected`/`cancelled`/`failed` payout. `count === 0`
    // means the payout is missing or not in a reviewable state — surface that
    // rather than silently no-op.
    const result = await this.prisma.payoutRequest.updateMany({
      where: { id: payoutId, status: { in: ['requested', 'under_review'] } },
      data: { status: 'approved', reviewerId, reviewNote: note, processedAt: new Date() },
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
    return this.payoutService.markPayoutPaid(payoutId, {
      providerTxId: data.providerTxId,
      paidAt: data.paidAt,
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
