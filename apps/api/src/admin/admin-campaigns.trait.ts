import { BadRequestException } from '@nestjs/common';

import { CampaignStatus, Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { getErrorCode } from '../common/utils/errors';
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
    // Audit: admin campaign approval — high-stakes lifecycle decision.
    void this.audit
      .log({
        actorId: reviewerId,
        actorRole: 'admin',
        action: 'approve_campaign',
        targetType: 'campaign',
        targetId: campaignId,
        beforeSnap: { oldStatus: 'submitted', newStatus, activated: canActivate },
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[AdminCampaignsTrait] audit log failure (approve_campaign): ${msg}`);
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
