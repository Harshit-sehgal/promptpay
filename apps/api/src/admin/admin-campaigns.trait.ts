import { BadRequestException, ConflictException } from '@nestjs/common';

import { CampaignStatus } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { PrismaService } from '../config/prisma.service';

export class AdminCampaignsTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;

  async getPendingCampaigns(
    query: {
      page?: number;
      limit?: number;
      status?: 'submitted' | 'approved';
    } = {},
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
    // Round 36: pre-compute the static creatives/budget predicates outside the
    // transaction (they don't drift on advertiser ledger), but defer the funded-
    // balance read to INSIDE the transaction. Reading it here on `this.prisma`
    // was a TOCTOU: a concurrent Stripe refund/dispute could drain the balance
    // to zero between this read and the CAS flip, flipping a campaign to
    // `active` on a stale funded-balance snapshot. The serving path's per-
    // impression debit guard still prevents overspend, but the campaign would be
    // briefly mislabelled activatable. Now the balance is re-evaluated under the
    // same row-locked transaction as the status flip.
    // Build human-readable blockers list for the UI (static portion)
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
      // Re-read the advertiser balance inside the transaction so the funded-
      // balance decision is consistent with the status flip under the same lock.
      const advertiserBalance = await getAdvertiserBalance(
        tx,
        campaign.advertiserId,
        campaign.currency,
      );
      const hasFundedBalance = advertiserBalance > 0;
      const canActivate = hasApprovedCreative && hasBudget && hasFundedBalance;
      const newStatus = canActivate ? 'active' : 'approved';
      if (!hasFundedBalance) {
        blockers.push('Advertiser has no funded balance. Deposit funds before activation.');
      }
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
      return { campaign: freshCampaign, activated: canActivate, status: newStatus };
    });
    // Audit: admin campaign approval — high-stakes lifecycle decision.
    void this.audit
      .log({
        actorId: reviewerId,
        actorRole: 'admin',
        action: 'approve_campaign',
        targetType: 'campaign',
        targetId: campaignId,
        beforeSnap: {
          oldStatus: 'submitted',
          newStatus: result.status,
          activated: result.activated,
        },
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[AdminCampaignsTrait] audit log failure (approve_campaign): ${msg}`);
      });

    return {
      campaign: result.campaign,
      activated: result.activated,
      status: result.status,
      blockers,
    };
  }

  async rejectCampaign(campaignId: string, reviewerId: string, reason: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'submitted') {
      throw new BadRequestException('Campaign must be in submitted status to reject');
    }
    await this.prisma.$transaction(async (tx) => {
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

    // Audit: admin campaign rejection — permanently closes a campaign.
    void this.audit
      .log({
        actorId: reviewerId,
        actorRole: 'admin',
        action: 'reject_campaign',
        targetType: 'campaign',
        targetId: campaignId,
        beforeSnap: { oldStatus: 'submitted', reason },
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[AdminCampaignsTrait] audit log failure (reject_campaign): ${msg}`);
      });
  }

  // ── Archive Refunds ──
  async getPendingArchiveRefunds(params: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const where = {
      entryType: 'refund' as const,
      status: 'pending' as const,
      idempotencyKey: { startsWith: 'archive_refund_' },
    };
    const [items, total] = await Promise.all([
      this.prisma.advertiserLedger.findMany({
        where: {
          ...where,
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.advertiserLedger.count({ where }),
    ]);
    return { items, total, page, limit, hasMore: page * limit < total };
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
    void params;
    throw new ConflictException(
      'Campaign archive refunds are disabled because campaign budgets are not escrowed. Reconcile legacy rows without posting ledger entries; real Stripe refunds are recorded by the signed webhook.',
    );
  }
}
