import { BadRequestException, ForbiddenException, Injectable, Logger,NotFoundException } from '@nestjs/common';

import { BidType, Prisma } from '@waitlayer/db';
import { AD_SERVING, CampaignStatus, DEFAULT_COMPANY_NAME } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { CampaignService } from '../campaign/campaign.service';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { getErrorCode } from '../common/utils/errors';
import { normalizeOptionalPublicHttpsUrl } from '../common/utils/external-url-policy';
import { PrismaService } from '../config/prisma.service';

/** Valid campaign status transitions */
const CAMPAIGN_TRANSITIONS: Record<string, CampaignStatus[]> = {
  draft: [CampaignStatus.SUBMITTED],
  submitted: [CampaignStatus.APPROVED, CampaignStatus.REJECTED],
  approved: [CampaignStatus.ACTIVE, CampaignStatus.REJECTED],
  active: [CampaignStatus.PAUSED],
  paused: [CampaignStatus.ACTIVE],
  rejected: [CampaignStatus.DRAFT],
  archived: [],
};

@Injectable()
export class AdvertiserService {
  private readonly logger = new Logger(AdvertiserService.name);
  constructor(private prisma: PrismaService, private campaignService: CampaignService, private audit: AuditService) {}

  /** Get or create advertiser profile for user */
  async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.advertiser.findUnique({ where: { userId } });
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'advertiser') throw new ForbiddenException('Not an advertiser account');

    // Concurrent getOrCreateProfile calls for the same first-time user both pass the
    // findUnique check and both attempt the create. The @@unique([userId]) catches the
    // second via P2002 — translate so the caller sees a clean Conflict instead of a 500.
    try {
      return await this.prisma.advertiser.create({
        data: { userId, companyName: user.name || DEFAULT_COMPANY_NAME, billingEmail: user.email },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Another call beat us — fetch and assert the winning row. Null here would
        // be a transient race after the P2002 (e.g. the winning row was deleted in
        // the gap), which is extraordinarily unlikely; we throw a clean 404 instead
        // of returning null and letting the caller `.id` it onto undefined.
        const winner = await this.prisma.advertiser.findUnique({ where: { userId } });
        if (!winner) throw new NotFoundException('Advertiser profile not found');
        return winner;
      }
      throw err;
    }
  }

  /** Resolve an advertiser by raw id — used by API-key auth where the key is
   *  scoped to a specific advertiser (no UserId lookup available). */
  async getProfileById(advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({ where: { id: advertiserId } });
    if (!advertiser) throw new NotFoundException('Advertiser not found');
    return advertiser;
  }

  async createProfile(userId: string, dto: { companyName: string; billingEmail: string; websiteUrl?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'advertiser') throw new ForbiddenException('Not an advertiser account');
    const existing = await this.prisma.advertiser.findUnique({ where: { userId } });
    if (existing) throw new BadRequestException('Advertiser profile already exists');
    // Concurrent createProfile calls race past the findUnique — the @@unique([userId])
    // catches the loser. Translate P2002 to ConflictException so the second caller
    // sees a clean 409, not a raw Prisma error leaked as a 500.
    try {
      const websiteUrl = normalizeOptionalPublicHttpsUrl(dto.websiteUrl, 'websiteUrl');
      const profile = await this.prisma.advertiser.create({ data: { userId, companyName: dto.companyName, billingEmail: dto.billingEmail, websiteUrl } });

      void this.audit.log({
        actorId: userId,
        actorRole: 'advertiser',
        action: 'create_advertiser_profile',
        targetType: 'advertiser',
        targetId: profile.id,
      });

      return profile;
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Advertiser profile already exists');
      }
      throw err;
    }
  }

  /** Get advertiser dashboard with aggregated metrics */
  async getDashboard(advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({ where: { id: advertiserId } });
    if (!advertiser) throw new NotFoundException('Advertiser not found');

    const campaigns = await this.prisma.campaign.findMany({
      where: { advertiserId },
      include: {
        creatives: {
          select: { id: true, status: true }
        }
      },
    });

    const totalImpressions = await this.prisma.adImpression.count({
      where: { campaign: { advertiserId }, isBillable: true },
    });

    const totalClicks = await this.prisma.adClick.count({
      where: { campaignId: { in: campaigns.map((c: { id: string }) => c.id) }, isValid: true },
    });

    const spend = await this.prisma.advertiserLedger.groupBy({
      by: ['currency'],
      where: { advertiserId, entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      _sum: { amountMinor: true },
    });
    const totalSpendByCurrency = Object.fromEntries(
      spend.map((row) => [row.currency, row._sum.amountMinor ?? 0]),
    );

    return {
      totalSpendMinor: totalSpendByCurrency.USD ?? 0,
      totalSpendByCurrency,
      totalImpressions,
      totalClicks,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      activeCampaigns: campaigns.filter((c: { status: string }) => c.status === 'active').length,
      totalCampaigns: campaigns.length,
      campaigns,
    };
  }

  /** Get advertiser billing balance and recent advertiser-ledger entries. */
  async getBilling(advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: advertiserId },
      select: { id: true },
    });
    if (!advertiser) throw new NotFoundException('Advertiser not found');

    const [totals, entries] = await Promise.all([
      this.prisma.advertiserLedger.groupBy({
        by: ['currency', 'entryType'],
        where: {
          advertiserId,
          entryType: { in: ['credit', 'debit'] },
          status: 'confirmed',
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.advertiserLedger.findMany({
        where: { advertiserId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          campaignId: true,
          entryType: true,
          status: true,
          amountMinor: true,
          currency: true,
          description: true,
          stripePaymentIntentId: true,
          stripeDisputeId: true,
          createdAt: true,
        },
      }),
    ]);

    const byCurrency = new Map<string, {
      currency: string;
      balanceMinor: number;
      totalDepositsMinor: number;
      totalChargesMinor: number;
    }>();

    for (const row of totals) {
      const currency = row.currency.toUpperCase();
      const current = byCurrency.get(currency) ?? {
        currency,
        balanceMinor: 0,
        totalDepositsMinor: 0,
        totalChargesMinor: 0,
      };
      const amount = row._sum.amountMinor ?? 0;
      if (row.entryType === 'credit') current.totalDepositsMinor += amount;
      if (row.entryType === 'debit') current.totalChargesMinor += amount;
      current.balanceMinor = current.totalDepositsMinor - current.totalChargesMinor;
      byCurrency.set(currency, current);
    }

    const balances = Array.from(byCurrency.values()).sort((a, b) => {
      if (a.currency === 'USD') return -1;
      if (b.currency === 'USD') return 1;
      return a.currency.localeCompare(b.currency);
    });
    const primary = balances[0] ?? {
      currency: 'USD',
      balanceMinor: 0,
      totalDepositsMinor: 0,
      totalChargesMinor: 0,
    };

    return {
      ...primary,
      balances,
      entries,
    };
  }

  /** Create a new campaign (always starts in DRAFT) */
  async createCampaign(advertiserId: string, dto: {
    name: string;
    category: string;
    bidType: string;
    bidAmountMinor: number;
    budgetTotalMinor: number;
    currency?: string;
    frequencyCapPerHour?: number;
    frequencyCapPerDay?: number;
  }) {
    // Validate budget
    if (dto.budgetTotalMinor < AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR) {
      throw new BadRequestException(`Minimum budget is $${AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR / 100}`);
    }
    if (dto.budgetTotalMinor > AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR) {
      throw new BadRequestException(`Maximum budget is $${AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR / 100}`);
    }
    if (dto.bidAmountMinor <= 0) {
      throw new BadRequestException('Bid amount must be positive');
    }

    // Validate campaign category (blocks prohibited categories)
    await this.campaignService.validateCampaignCategory(dto.category);

    const currency = dto.currency?.trim().toUpperCase() || 'USD';

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
      beforeSnap: { name: dto.name, category: dto.category, bidType: dto.bidType, budgetTotalMinor: dto.budgetTotalMinor },
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
      await this.throwCampaignStateConflict(campaignId, advertiserId, 'Campaign can only be submitted from DRAFT status');
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
      await this.throwCampaignStateConflict(campaignId, advertiserId, 'Campaign can only be paused from ACTIVE status');
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
      throw new BadRequestException('Cannot resume campaign: at least one approved creative is required');
    }
    if (campaign.budgetSpentMinor >= campaign.budgetTotalMinor) {
      throw new BadRequestException('Cannot resume campaign: budget has been fully spent');
    }

    const balance = await this.getAdvertiserBalance(advertiserId, campaign.currency);
    if (balance <= 0) {
      throw new BadRequestException('Cannot resume campaign: advertiser has no funded balance. Please deposit funds first.');
    }

    this.validateTransition(campaign.status, 'active');
    const claimed = await this.prisma.campaign.updateMany({
      where: { id: campaignId, advertiserId, status: CampaignStatus.PAUSED },
      data: { status: CampaignStatus.ACTIVE, pausedAt: null, activatedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.throwCampaignStateConflict(campaignId, advertiserId, 'Campaign can only be resumed from PAUSED status');
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
        return { archived: false as const, refundEntry: null as { id: string; amountMinor: number } | null };
      }

      // Re-read the now-archived row inside the tx to get the authoritative
      // `budgetSpentMinor` (the outer snapshot may be stale). The row is
      // already locked by the UPDATE above so this read is consistent with
      // the status flip and any concurrent impression has been blocked.
      const locked = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { budgetTotalMinor: true, budgetSpentMinor: true, currency: true },
      });
      const unspentMinor = Math.max(
        0,
        (locked?.budgetTotalMinor ?? 0) - (locked?.budgetSpentMinor ?? 0),
      );

      // Record the refund obligation row. Use `entryType: 'refund'` (NOT
      // 'credit') + `status: 'pending'` so the row is doubly excluded from
      // any "advertiser available balance" computation: a generic
      // `entryType:'credit'` sum (which would otherwise absorb a pending
      // credit into spendable balance) never sees it, and the `pending`
      // status excludes it from confirmed-balance sums too. The row
      // represents a platform obligation to the advertiser — the cash
      // hasn't moved yet. An admin flips it to `confirmed` after manually
      // issuing the Stripe refund (separate admin endpoint).
      let refundEntry: { id: string; amountMinor: number } | null = null;
      if (unspentMinor > 0) {
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

      return { archived: true as const, refundEntry, unspentMinor, currency: locked?.currency ?? campaign.currency };
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
      beforeSnap: { oldStatus: campaign.status, refundObligationMinor: result.unspentMinor, currency: result.currency },
    });

    return { campaign: updated, refundEntry: result.refundEntry ?? null, archived: true };
  }

  /** Update campaign details (only in DRAFT status) */
  async updateCampaign(campaignId: string, advertiserId: string, dto: {
    name?: string;
    bidAmountMinor?: number;
    budgetTotalMinor?: number;
    frequencyCapPerHour?: number;
    frequencyCapPerDay?: number;
  }) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Campaign can only be edited in DRAFT status');
    }
    // Re-validate inputs — the createCampaign path enforces bounds, but
    // an update can be used to bypass them. Mirror the same checks.
    if (dto.budgetTotalMinor !== undefined) {
      if (dto.budgetTotalMinor < AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR) {
        throw new BadRequestException(`Minimum budget is $${AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR / 100}`);
      }
      if (dto.budgetTotalMinor > AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR) {
        throw new BadRequestException(`Maximum budget is $${AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR / 100}`);
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
      await this.throwCampaignStateConflict(campaignId, advertiserId, 'Campaign can only be edited in DRAFT status');
    }
    const updated = await this.prisma.campaign.findUnique({ where: { id: campaignId } });

    void this.audit.log({
      actorId: advertiserId,
      actorRole: 'advertiser',
      action: 'update_campaign',
      targetType: 'campaign',
      targetId: campaignId,
      beforeSnap: { changes: dto },
    });

    return updated;
  }

  private async throwCampaignStateConflict(
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

  /** Get reports for advertiser campaigns — aggregated by campaign */
  async getReports(
    advertiserId: string,
    params: { campaignId?: string; from?: string; to?: string; page?: number; limit?: number },
  ) {
    const campaignWhere: Prisma.CampaignWhereInput = { advertiserId };
    if (params.campaignId) campaignWhere.id = params.campaignId;

    const campaigns = await this.prisma.campaign.findMany({
      where: campaignWhere,
      select: { id: true, name: true, status: true, currency: true },
    });
    const campaignIds = campaigns.map((campaign) => campaign.id);

    // Parse date range
    const gte = params.from ? new Date(params.from) : undefined;
    const lte = params.to ? new Date(params.to) : undefined;
    if (gte && Number.isNaN(gte.getTime())) {
      throw new BadRequestException(`Invalid 'from' date: ${params.from}`);
    }
    if (lte && Number.isNaN(lte.getTime())) {
      throw new BadRequestException(`Invalid 'to' date: ${params.to}`);
    }

    // Build the time filter. A date-ONLY `to` (no 'T', e.g. "2026-07-09") is
    // parsed by `new Date(...)` as midnight at the START of that day, which
    // would exclude every impression/click that happened later on the selected
    // end day (issue A-050). Treat a date-only `to` as inclusive-of-the-day by
    // using an exclusive next-day lower bound (`lt`); ISO datetimes are kept
    // as an inclusive upper bound (`lte`). "Last 24h" callers should pass a
    // full ISO datetime for `from`/`to`.
    const createdAt: { gte?: Date; lte?: Date; lt?: Date } = {};
    if (gte) createdAt.gte = gte;
    if (params.to) {
      if (params.to.includes('T')) {
        createdAt.lte = lte;
      } else {
        const toDate = new Date(params.to);
        createdAt.lt = new Date(
          toDate.getFullYear(),
          toDate.getMonth(),
          toDate.getDate() + 1,
        );
      }
    }
    const timeFilter = Object.keys(createdAt).length > 0 ? { createdAt } : {};

    // Aggregate impressions + clicks per campaign in the database (groupBy)
    // instead of loading every raw billable row into application memory (A-007).
    const impCounts = await this.prisma.adImpression.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, isBillable: true, ...timeFilter },
      _count: { _all: true },
    });
    const impByCampaign = new Map<string, number>(
      impCounts.map((r) => [r.campaignId, r._count._all]),
    );

    const clickCounts = await this.prisma.adClick.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, isValid: true, ...timeFilter },
      _count: { _all: true },
    });
    const clicksByCampaign = new Map<string, number>(
      clickCounts.map((r) => [r.campaignId, r._count._all]),
    );

    // Get spend per campaign from advertiser ledger
    const spendRows = await this.prisma.advertiserLedger.groupBy({
      by: ['campaignId', 'currency'],
      where: {
        advertiserId,
        campaignId: { in: campaignIds },
        entryType: 'debit',
        status: { in: ['confirmed', 'paid'] },
        ...timeFilter,
      },
      _sum: { amountMinor: true },
    });
    const spendByCampaignCurrency = new Map(
      spendRows.map((r) => [`${r.campaignId}:${r.currency}`, r._sum.amountMinor ?? 0]),
    );

    // Daily aggregation for trend chart — only the `createdAt` column is needed
    // for day-bucketing, so select just that rather than full impression/click
    // rows (keeps memory bounded for large date ranges, A-007).
    const dailyImpressions = await this.prisma.adImpression.findMany({
      where: { campaignId: { in: campaignIds }, isBillable: true, ...timeFilter },
      select: { createdAt: true },
    });
    const dailyClicks = await this.prisma.adClick.findMany({
      where: { campaignId: { in: campaignIds }, isValid: true, ...timeFilter },
      select: { createdAt: true },
    });

    const dailyMap = new Map<string, { impressions: number; clicks: number; date: string }>();
    for (const imp of dailyImpressions) {
      const day = imp.createdAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(day) ?? { date: day, impressions: 0, clicks: 0 };
      entry.impressions++;
      dailyMap.set(day, entry);
    }
    for (const click of dailyClicks) {
      const day = click.createdAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(day) ?? { date: day, impressions: 0, clicks: 0 };
      entry.clicks++;
      dailyMap.set(day, entry);
    }
    const dailyTrend = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Build per-campaign rows
    const rows = campaigns.map((campaign) => {
      const impressions = impByCampaign.get(campaign.id) ?? 0;
      const clicks = clicksByCampaign.get(campaign.id) ?? 0;
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const spendMinor = spendByCampaignCurrency.get(`${campaign.id}:${campaign.currency}`) ?? 0;
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        impressions,
        clicks,
        ctr,
        spendMinor,
        currency: campaign.currency,
      };
    });

    // Summary
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalSpendByCurrency = rows.reduce<Record<string, number>>((totals, row) => {
      totals[row.currency] = (totals[row.currency] ?? 0) + row.spendMinor;
      return totals;
    }, {});
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

    return {
      rows,
      dailyTrend,
      summary: {
        totalImpressions,
        totalClicks,
        totalSpendMinor: totalSpendByCurrency.USD ?? 0,
        totalSpendByCurrency,
        avgCtr,
        totalCampaigns: campaigns.length,
      },
    };
  }

  // ── Private ──

  private validateTransition(currentStatus: string, newStatus: string) {
    const allowed = CAMPAIGN_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus as CampaignStatus)) {
      throw new BadRequestException(
        `Invalid campaign transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }
  }

  private getAdvertiserBalance(advertiserId: string, currency: string): Promise<number> {
    return getAdvertiserBalance(this.prisma, advertiserId, currency);
  }
}
