import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';

import { BidType, Prisma } from '@waitlayer/db';
import {
  AD_SERVING,
  campaignMaximumBudgetMinor,
  campaignMinimumBidMinor,
  campaignMinimumBudgetMinor,
  CampaignStatus,
  formatMinorUnits,
  getCurrencyPolicy,
} from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { CampaignService } from '../campaign/campaign.service';
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
    const currency = dto.currency?.trim().toUpperCase() || 'USD';
    // Validate budget against the PER-CURRENCY policy (#5). The old global
    // MIN_CAMPAIGN_BUDGET_MINOR/MAX_CAMPAIGN_BUDGET_MINOR constants represent a
    // USD-shaped `$50`/`$1M` that, when re-applied verbatim to a zero-decimal
    // currency (JPY) or three-decimal currency (BHD), are economically wrong.
    // Each supported currency now carries its own minor-unit thresholds in
    // CURRENCY_POLICY — the single source of truth for DTO, service, web.
    if (!getCurrencyPolicy(currency)) {
      throw new BadRequestException(`Currency "${currency}" is not supported`);
    }
    const minBudget = campaignMinimumBudgetMinor(currency);
    const maxBudget = campaignMaximumBudgetMinor(currency);
    if (dto.budgetTotalMinor < minBudget) {
      throw new BadRequestException(
        `Minimum budget is ${formatMinorUnits(minBudget, currency)} (${currency})`,
      );
    }
    if (dto.budgetTotalMinor > maxBudget) {
      throw new BadRequestException(
        `Maximum budget is ${formatMinorUnits(maxBudget, currency)} (${currency})`,
      );
    }
    if (dto.bidAmountMinor <= 0n) {
      throw new BadRequestException('Bid amount must be positive');
    }
    const minBid = campaignMinimumBidMinor(currency);
    if (dto.bidAmountMinor < minBid) {
      throw new BadRequestException(
        `Minimum bid is ${formatMinorUnits(minBid, currency)} (${currency})`,
      );
    }
    // bid must never exceed total budget, and the budget must cover at least
    // one billable event of this campaign's bid type.
    if (dto.bidAmountMinor > dto.budgetTotalMinor) {
      throw new BadRequestException('Bid amount cannot exceed total budget');
    }
    if (dto.budgetTotalMinor < dto.bidAmountMinor) {
      throw new BadRequestException('Budget must cover at least one billable event');
    }
    // Validate campaign category (blocks prohibited categories)
    await this.campaignService.validateCampaignCategory(dto.category);
    if (!(await this.runtimeConfig.isCurrencyAllowed(currency))) {
      throw new BadRequestException(`Currency "${currency}" is currently blocked`);
    }
    const campaign = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.campaign.create({
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
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'create_campaign',
          targetType: 'campaign',
          targetId: created.id,
          beforeSnap: {
            name: dto.name,
            category: dto.category,
            bidType: dto.bidType,
            budgetTotalMinor: String(dto.budgetTotalMinor),
          },
        },
        tx,
      );
      return created;
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
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'submit_campaign',
          targetType: 'campaign',
          targetId: campaignId,
          beforeSnap: { oldStatus: campaign.status },
        },
        tx,
      );
      return tx.campaign.findUnique({ where: { id: campaignId } });
    });
    if (!submitted) {
      await this.throwCampaignStateConflict(
        campaignId,
        advertiserId,
        'Campaign can only be submitted from DRAFT status',
      );
    }
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
    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.campaign.updateMany({
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
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'reset_campaign_to_draft',
          targetType: 'campaign',
          targetId: campaignId,
        },
        tx,
      );
      return tx.campaign.findUnique({ where: { id: campaignId } });
    });
    return updated;
  }

  /** Pause an active campaign */
  async pauseCampaign(campaignId: string, advertiserId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    this.validateTransition(campaign.status, 'paused');
    const paused = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.campaign.updateMany({
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
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'pause_campaign',
          targetType: 'campaign',
          targetId: campaignId,
        },
        tx,
      );
      return tx.campaign.findUnique({ where: { id: campaignId } });
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
    const resumed = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.campaign.updateMany({
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
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'resume_campaign',
          targetType: 'campaign',
          targetId: campaignId,
        },
        tx,
      );
      return tx.campaign.findUnique({ where: { id: campaignId } });
    });
    return resumed;
  }

  /**
   * Permanently archive a campaign and release its in-flight serving capacity.
   * Campaign budgets are serving caps, not escrow: deposits belong to the
   * advertiser and can fund multiple campaigns. Archiving therefore never
   * manufactures a cash-refund obligation from `budgetTotal - budgetSpent`;
   * real unspent cash remains in the advertiser's shared ledger balance.
   */
  async archiveCampaign(campaignId: string, advertiserId: string) {
    // Pre-ownership + existence check (without holding any row locks).
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    // Idempotent: already archived → return as-is.
    if (campaign.status === 'archived') {
      return { campaign, refundEntry: null, archived: false };
    }
    // Allow archiving from any non-terminal state. `archived` is the only
    // state we explicitly reject above (idempotent). The CAMPAIGN_TRANSITIONS
    // table doesn't list archived as a target for any state, so we bypass
    // validateTransition here — archive is a deliberate "close forever"
    // action available from every live state.
    //
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // CAS flip: only if not already archived (re-invocation guard). This
      // UPDATE acquires the row lock; concurrent impression writes to
      // `budgetSpentMinor` block until we commit.
      const claimed = await tx.campaign.updateMany({
        where: { id: campaignId, status: { not: 'archived' } },
        // Archive is terminal. Releasing reservations in the same row-locking
        // write ensures the refund cannot include budget that a later
        // qualification still converts to spend.
        data: { status: 'archived', archivedAt: new Date(), budgetReservedMinor: 0n },
      });
      if (claimed.count === 0) {
        return { archived: false as const };
      }
      // Archive is a terminal money-relevant state change; the audit must be
      // part of the same transaction so a rolled-back archive never leaves a
      // false success record.
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'archive_campaign',
          targetType: 'campaign',
          targetId: campaignId,
          beforeSnap: {
            oldStatus: campaign.status,
            releasedReservationMinor: String(campaign.budgetReservedMinor ?? 0n),
            currency: campaign.currency,
          },
        },
        tx,
      );
      return { archived: true as const };
    });
    if (!result.archived) {
      return { campaign, refundEntry: null, archived: false };
    }
    const updated = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    this.logger.log(`Archived campaign ${campaignId}; advertiser funds remain in shared balance`);
    return { campaign: updated, refundEntry: null, archived: true };
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
    // an update can be used to bypass them. Mirror the same per-currency checks.
    const validationCurrency = (dto.currency ?? campaign.currency).trim().toUpperCase();
    if (!getCurrencyPolicy(validationCurrency)) {
      throw new BadRequestException(`Currency "${validationCurrency}" is not supported`);
    }
    const effectiveBid = dto.bidAmountMinor ?? campaign.bidAmountMinor;
    const effectiveBudget = dto.budgetTotalMinor ?? campaign.budgetTotalMinor;
    if (dto.budgetTotalMinor !== undefined) {
      const minBudget = campaignMinimumBudgetMinor(validationCurrency);
      const maxBudget = campaignMaximumBudgetMinor(validationCurrency);
      if (dto.budgetTotalMinor < minBudget) {
        throw new BadRequestException(
          `Minimum budget is ${formatMinorUnits(minBudget, validationCurrency)} (${validationCurrency})`,
        );
      }
      if (dto.budgetTotalMinor > maxBudget) {
        throw new BadRequestException(
          `Maximum budget is ${formatMinorUnits(maxBudget, validationCurrency)} (${validationCurrency})`,
        );
      }
    }
    if (dto.bidAmountMinor !== undefined) {
      if (dto.bidAmountMinor <= 0n) {
        throw new BadRequestException('Bid amount must be positive');
      }
      const minBid = campaignMinimumBidMinor(validationCurrency);
      if (dto.bidAmountMinor < minBid) {
        throw new BadRequestException(
          `Minimum bid is ${formatMinorUnits(minBid, validationCurrency)} (${validationCurrency})`,
        );
      }
    }
    // Combined bid<=budget invariant
    if (effectiveBudget < effectiveBid) {
      throw new BadRequestException('Bid amount cannot exceed total budget');
    }
    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.campaign.updateMany({
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
      await this.audit.logStrict(
        {
          actorId: advertiserId,
          actorRole: 'advertiser',
          action: 'update_campaign',
          targetType: 'campaign',
          targetId: campaignId,
          beforeSnap: {
            changes: {
              ...dto,
              bidAmountMinor:
                dto.bidAmountMinor !== undefined ? String(dto.bidAmountMinor) : undefined,
              budgetTotalMinor:
                dto.budgetTotalMinor !== undefined ? String(dto.budgetTotalMinor) : undefined,
            },
          },
        },
        tx,
      );
      return tx.campaign.findUnique({ where: { id: campaignId } });
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
