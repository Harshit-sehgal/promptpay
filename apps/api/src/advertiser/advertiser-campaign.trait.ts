import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';

import { BidType, Prisma } from '@waitlayer/db';
import { AD_SERVING, CampaignStatus } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { CampaignService } from '../campaign/campaign.service';
import { getErrorCode } from '../common/utils/errors';
import { PrismaService } from '../config/prisma.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { CAMPAIGN_TRANSITIONS } from './advertiser.constants';
import { AdvertiserProfileTrait } from './advertiser-profile.trait';

export class AdvertiserCampaignTrait {
  declare prisma: PrismaService;
  declare campaignService: CampaignService;
  declare audit: AuditService;
  declare runtimeConfig: RuntimeConfigService;
  declare logger: Logger;

  /** Create a new campaign (always starts in DRAFT) */
  async createCampaign(
    advertiserId: string,
    dto: {
      name: string;
      category: string;
      bidType: string;
      bidAmountMinor: bigint;
      budgetTotalMinor: bigint;
      currency?: string;
      frequencyCapPerHour?: number;
      frequencyCapPerDay?: number;
    },
  ) {
    // Validate budget
    if (dto.budgetTotalMinor < AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR) {
      throw new BadRequestException(
        `Minimum budget is $${AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR / 100}`,
      );
    }
    if (dto.budgetTotalMinor > AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR) {
      throw new BadRequestException(
        `Maximum budget is $${AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR / 100}`,
      );
    }
    if (dto.bidAmountMinor <= 0) {
      throw new BadRequestException('Bid amount must be positive');
    }
    // Validate campaign category (blocks prohibited categories)
    await this.campaignService.validateCampaignCategory(dto.category);
    const currency = dto.currency?.trim().toUpperCase() || 'USD';
    if (!(await this.runtimeConfig.isCurrencyAllowed(currency))) {
      throw new BadRequestException(`Currency "${currency}" is currently blocked`);
    }
    const campaign = await this.prisma.campaign.create({
      data: {
        advertiserId,
        name: dto.name,
        category: dto.category,
        bidType: dto.bidType as BidType,
        bidAmountMinor: dto.bidAmountMinor,
        budgetTotalMinor: dto.budgetTotalMinor,
        currency,
        frequencyCapPerHour: dto.frequencyCapPerHour ?? AD_SERVING.DEFAULT_FREQUENCY_CAP_PER_HOUR,
        frequencyCapPerDay: dto.frequencyCapPerDay ?? AD_SERVING.DEFAULT_FREQUENCY_CAP_PER_DAY,
      },
    });
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'create_campaign',
      targetType: 'campaign',
      targetId: campaign.id,
      beforeSnap: {
        name: dto.name,
        category: dto.category,
        bidType: dto.bidType,
        budgetTotalMinor: String(dto.budgetTotalMinor),
      },
    });
    return campaign;
  }

  /** Submit a draft campaign for review */
  async submitCampaign(campaignId: string, advertiserId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { creatives: true },
    });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    // Must have at least one creative before submission
    if (campaign.creatives.length === 0) {
      throw new BadRequestException('Campaign must have at least one creative before submission');
    }
    this.validateTransition(campaign.status, 'submitted');
    const submitted = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.campaign.updateMany({
        where: { id: campaignId, advertiserId, status: CampaignStatus.DRAFT },
        data: { status: CampaignStatus.SUBMITTED, submittedAt: new Date() },
      });
      if (claimed.count === 0) return null;
      await tx.adCreative.updateMany({
        where: { campaignId, status: 'draft' },
        data: { status: 'pending_review' },
      });
      return tx.campaign.findUnique({ where: { id: campaignId } });
    });
    if (!submitted) {
      await this.throwCampaignStateConflict(
        campaignId,
        advertiserId,
        'Campaign can only be submitted from DRAFT status',
      );
    }
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'submit_campaign',
      targetType: 'campaign',
      targetId: campaignId,
      beforeSnap: { oldStatus: campaign.status },
    });
    return submitted;
  }

  /**
   * Reset a REJECTED campaign back to DRAFT so the advertiser can edit the
   * creative and resubmit (issue A-021). This is the missing half of the
   * draft → submit → reject → resubmit recovery loop: `rejected` is declared
   * as transitioning only to `draft` in CAMPAIGN_TRANSITIONS, so a rejected
   * campaign cannot be edited or resubmitted until it is reset to draft.
   */
  async resetCampaignToDraft(campaignId: string, advertiserId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    this.validateTransition(campaign.status, 'draft');
    const claimed = await this.prisma.campaign.updateMany({
      where: { id: campaignId, advertiserId, status: CampaignStatus.REJECTED },
      data: { status: CampaignStatus.DRAFT },
    });
    if (claimed.count === 0) {
      await this.throwCampaignStateConflict(
        campaignId,
        advertiserId,
        'Campaign can only be reset to draft from REJECTED status',
      );
    }
    const updated = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'reset_campaign_to_draft',
      targetType: 'campaign',
      targetId: campaignId,
    });
    return updated;
  }

  /** Pause an active campaign */
  async pauseCampaign(campaignId: string, advertiserId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    this.validateTransition(campaign.status, 'paused');
    const claimed = await this.prisma.campaign.updateMany({
      where: { id: campaignId, advertiserId, status: CampaignStatus.ACTIVE },
      data: { status: CampaignStatus.PAUSED, pausedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.throwCampaignStateConflict(
        campaignId,
        advertiserId,
        'Campaign can only be paused from ACTIVE status',
      );
    }
    const paused = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'pause_campaign',
      targetType: 'campaign',
      targetId: campaignId,
    });
    return paused;
  }

  /** Resume a paused campaign */
  async resumeCampaign(campaignId: string, advertiserId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { creatives: true },
    });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    const hasApprovedCreative = campaign.creatives.some((c) => c.status === 'approved');
    if (!hasApprovedCreative) {
      throw new BadRequestException(
        'Cannot resume campaign: at least one approved creative is required',
      );
    }
    if (campaign.budgetSpentMinor >= campaign.budgetTotalMinor) {
      throw new BadRequestException('Cannot resume campaign: budget has been fully spent');
    }
    const balance = await this.getAdvertiserBalance(advertiserId, campaign.currency);
    if (balance <= 0n) {
      throw new BadRequestException(
        'Cannot resume campaign: advertiser has no funded balance. Please deposit funds first.',
      );
    }
    this.validateTransition(campaign.status, 'active');
    const claimed = await this.prisma.campaign.updateMany({
      where: { id: campaignId, advertiserId, status: CampaignStatus.PAUSED },
      data: { status: CampaignStatus.ACTIVE, pausedAt: null, activatedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.throwCampaignStateConflict(
        campaignId,
        advertiserId,
        'Campaign can only be resumed from PAUSED status',
      );
    }
    const resumed = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'resume_campaign',
      targetType: 'campaign',
      targetId: campaignId,
    });
    return resumed;
  }

  /**
   * Archive a campaign — permanent close that stops all future ad spend and
   * records the unspent-budget refund obligation.
   *
   * Which states can transition to `archived`:
   *   - `draft` / `submitted` / `approved` (never served) — full budget refundable.
   *   - `paused` / `active` (partially served) — unspent balance refundable.
   *   - `rejected` — refundable per above.
   *   - already `archived` — idempotent return.
   *
   * Refund model: an `advertiserLedger` `credit` row tagged with `campaignId`,
   * status `pending`, amount = `budgetTotalMinor - budgetSpentMinor`. We use
   * `pending` (not `confirmed`) because the actual Stripe refund has to be
   * initiated by an admin in the Stripe dashboard — the platform's obligation
   * to refund is recorded here, the cash movement is completed offline. The
   * row's `idempotencyKey` is keyed by the campaign id so a re-invoked
   * archive is a clean P2002 no-op (and an idempotent return for the
   * already-archived campaign row).
   *
   * We do NOT auto-refund via Stripe in this MVP — there's no reliable way to
   * select which deposit PI to refund against (a campaign's spend isn't 1:1
   * linked to a specific deposit), and auto-issuing a Stripe refund that the
   * advertiser didn't request would be a surprising money movement. The
   * admin reconciles the pending row against the Stripe dashboard and issues
   * the refund, then flips the row to `confirmed` (a future admin endpoint).
   */
  async archiveCampaign(campaignId: string, advertiserId: string) {
    // Pre-ownership + existence check (without holding any row locks).
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    // Idempotent: already archived → return as-is.
    if (campaign.status === 'archived') {
      const existingRefund = await this.prisma.advertiserLedger.findUnique({
        where: { idempotencyKey: `archive_refund_${campaignId}` },
      });
      return { campaign, refundEntry: existingRefund ?? null, archived: false };
    }
    // Allow archiving from any non-terminal state. `archived` is the only
    // state we explicitly reject above (idempotent). The CAMPAIGN_TRANSITIONS
    // table doesn't list archived as a target for any state, so we bypass
    // validateTransition here — archive is a deliberate "close forever"
    // action available from every live state.
    //
    // The `unspentMinor` snapshot is read INSIDE the transaction (not from
    // the outer `campaign` row) so a concurrent impression that increments
    // `budgetSpentMinor` either commits before us (we see the new value) or
    // blocks on the row lock we hold until we commit (it then sees
    // `status='archived'` and refuses to bill — see the status guard in
    // recordImpressionEarnings / recordClickEarnings). Either way the refund
    // amount matches the actual unspent balance at archive time. The
    // single plain `campaign.updateMany` below functions as the row write
    // that establishes the lock; the read that determines `unspentMinor`
    // happens after that write under the same tx so it observes a locked
    // snapshot of the row.
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // CAS flip: only if not already archived (re-invocation guard). This
      // UPDATE acquires the row lock; concurrent impression writes to
      // `budgetSpentMinor` block until we commit.
      const claimed = await tx.campaign.updateMany({
        where: { id: campaignId, status: { not: 'archived' } },
        data: { status: 'archived', archivedAt: new Date() },
      });
      if (claimed.count === 0) {
        // Lost race to another archiver — already archived.
        return {
          archived: false as const,
          refundEntry: null as {
            id: string;
            amountMinor: bigint;
          } | null,
        };
      }
      // Re-read the now-archived row inside the tx to get the authoritative
      // `budgetSpentMinor` (the outer snapshot may be stale). The row is
      // already locked by the UPDATE above so this read is consistent with
      // the status flip and any concurrent impression has been blocked.
      const locked = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { budgetTotalMinor: true, budgetSpentMinor: true, currency: true },
      });
      const unspentMinor = (locked?.budgetTotalMinor ?? 0n) - (locked?.budgetSpentMinor ?? 0n);
      // Record the refund obligation row. Use `entryType: 'refund'` (NOT
      // 'credit') + `status: 'pending'` so the row is doubly excluded from
      // any "advertiser available balance" computation: a generic
      // `entryType:'credit'` sum (which would otherwise absorb a pending
      // credit into spendable balance) never sees it, and the `pending`
      // status excludes it from confirmed-balance sums too. The row
      // represents a platform obligation to the advertiser — the cash
      // hasn't moved yet. An admin flips it to `confirmed` after manually
      // issuing the Stripe refund (separate admin endpoint).
      let refundEntry: {
        id: string;
        amountMinor: bigint;
      } | null = null;
      if (unspentMinor > 0n) {
        try {
          refundEntry = await tx.advertiserLedger.create({
            data: {
              advertiserId,
              campaignId,
              entryType: 'refund',
              status: 'pending',
              amountMinor: unspentMinor,
              currency: locked?.currency ?? campaign.currency,
              idempotencyKey: `archive_refund_${campaignId}`,
              description: `Unspent-budget refund obligation — campaign ${campaignId} archived (${unspentMinor} ${locked?.currency ?? campaign.currency})`,
            },
          });
        } catch (err: unknown) {
          // P2002 here means a prior archive invocation wrote the row before
          // the status CAS caught it — shouldn't be reachable given the
          // outer fast-path, but tolerate it rather than aborting the tx.
          if (getErrorCode(err) !== 'P2002') throw err;
          refundEntry = await tx.advertiserLedger.findUnique({
            where: { idempotencyKey: `archive_refund_${campaignId}` },
          });
        }
      }
      return {
        archived: true as const,
        refundEntry,
        unspentMinor,
        currency: locked?.currency ?? campaign.currency,
      };
    });
    if (!result.archived) {
      // Mirror the idempotent already-archived return shape.
      const existingRefund = await this.prisma.advertiserLedger.findUnique({
        where: { idempotencyKey: `archive_refund_${campaignId}` },
      });
      return { campaign, refundEntry: existingRefund ?? null, archived: false };
    }
    const updated = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    this.logger.log(
      `Archived campaign ${campaignId}: unspent refund obligation = ${result.unspentMinor} ${result.currency}`,
    );
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'archive_campaign',
      targetType: 'campaign',
      targetId: campaignId,
      beforeSnap: {
        oldStatus: campaign.status,
        refundObligationMinor: String(result.unspentMinor),
        currency: result.currency,
      },
    });
    return { campaign: updated, refundEntry: result.refundEntry ?? null, archived: true };
  }

  /** Update campaign details (only in DRAFT status) */
  async updateCampaign(
    campaignId: string,
    advertiserId: string,
    dto: {
      name?: string;
      bidAmountMinor?: bigint;
      budgetTotalMinor?: bigint;
      currency?: string;
      frequencyCapPerHour?: number;
      frequencyCapPerDay?: number;
    },
  ) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Campaign can only be edited in DRAFT status');
    }
    // A-081: allow currency selection on drafts so a campaign can be created
    // in a funded non-USD balance (otherwise a non-USD deposit is stranded).
    if (dto.currency !== undefined) {
      dto.currency = dto.currency.trim().toUpperCase();
      if (!(await this.runtimeConfig.isCurrencyAllowed(dto.currency))) {
        throw new BadRequestException(`Currency "${dto.currency}" is currently blocked`);
      }
    }
    // Re-validate inputs — the createCampaign path enforces bounds, but
    // an update can be used to bypass them. Mirror the same checks.
    if (dto.budgetTotalMinor !== undefined) {
      if (dto.budgetTotalMinor < AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR) {
        throw new BadRequestException(
          `Minimum budget is $${AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR / 100}`,
        );
      }
      if (dto.budgetTotalMinor > AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR) {
        throw new BadRequestException(
          `Maximum budget is $${AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR / 100}`,
        );
      }
    }
    if (dto.bidAmountMinor !== undefined && dto.bidAmountMinor <= 0) {
      throw new BadRequestException('Bid amount must be positive');
    }
    const claimed = await this.prisma.campaign.updateMany({
      where: { id: campaignId, advertiserId, status: CampaignStatus.DRAFT },
      data: dto,
    });
    if (claimed.count === 0) {
      await this.throwCampaignStateConflict(
        campaignId,
        advertiserId,
        'Campaign can only be edited in DRAFT status',
      );
    }
    const updated = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'update_campaign',
      targetType: 'campaign',
      targetId: campaignId,
      beforeSnap: {
        changes: {
          ...dto,
          bidAmountMinor: dto.bidAmountMinor !== undefined ? String(dto.bidAmountMinor) : undefined,
          budgetTotalMinor:
            dto.budgetTotalMinor !== undefined ? String(dto.budgetTotalMinor) : undefined,
        },
      },
    });
    return updated;
  }

  async throwCampaignStateConflict(
    campaignId: string,
    advertiserId: string,
    message: string,
  ): Promise<never> {
    const current = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { advertiserId: true, status: true },
    });
    if (!current || current.advertiserId !== advertiserId) throw new ForbiddenException();
    throw new BadRequestException(`${message}; current status is ${current.status}`);
  }

  // ── Private ──
  validateTransition(currentStatus: string, newStatus: string) {
    const allowed = CAMPAIGN_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus as CampaignStatus)) {
      throw new BadRequestException(
        `Invalid campaign transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }
  }
}
export interface AdvertiserCampaignTrait extends AdvertiserProfileTrait {}
