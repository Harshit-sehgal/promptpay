import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { BidType, Prisma } from '@waitlayer/db';
import { PrismaService } from '../config/prisma.service';
import { CampaignService } from '../campaign/campaign.service';
import { CampaignStatus, AD_SERVING, DEFAULT_COMPANY_NAME } from '@waitlayer/shared';

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
  constructor(private prisma: PrismaService, private campaignService: CampaignService) {}

  /** Get or create advertiser profile for user */
  async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.advertiser.findUnique({ where: { userId } });
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'advertiser') throw new ForbiddenException('Not an advertiser account');

    return this.prisma.advertiser.create({
      data: { userId, companyName: user.name || DEFAULT_COMPANY_NAME, billingEmail: user.email },
    });
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
    return this.prisma.advertiser.create({ data: { userId, companyName: dto.companyName, billingEmail: dto.billingEmail, websiteUrl: dto.websiteUrl } });
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

    const spend = await this.prisma.advertiserLedger.aggregate({
      where: { advertiserId, entryType: 'debit', status: { in: ['confirmed', 'paid'] } },
      _sum: { amountMinor: true },
    });

    return {
      totalSpendMinor: spend._sum.amountMinor || 0,
      totalImpressions,
      totalClicks,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      activeCampaigns: campaigns.filter((c: { status: string }) => c.status === 'active').length,
      totalCampaigns: campaigns.length,
      campaigns,
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

    return this.prisma.campaign.create({
      data: {
        advertiserId,
        name: dto.name,
        category: dto.category,
        bidType: dto.bidType as BidType,
        bidAmountMinor: dto.bidAmountMinor,
        budgetTotalMinor: dto.budgetTotalMinor,
        currency: dto.currency || 'USD',
        frequencyCapPerHour: dto.frequencyCapPerHour ?? AD_SERVING.DEFAULT_FREQUENCY_CAP_PER_HOUR,
        frequencyCapPerDay: dto.frequencyCapPerDay ?? AD_SERVING.DEFAULT_FREQUENCY_CAP_PER_DAY,
      },
    });
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

    // Update campaign status to submitted and set all draft creatives to pending_review
    await this.prisma.adCreative.updateMany({
      where: { campaignId, status: 'draft' },
      data: { status: 'pending_review' },
    });

    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'submitted', submittedAt: new Date() },
    });
  }

  /** Pause an active campaign */
  async pauseCampaign(campaignId: string, advertiserId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    this.validateTransition(campaign.status, 'paused');
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'paused', pausedAt: new Date() },
    });
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

    this.validateTransition(campaign.status, 'active');
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'active', pausedAt: null, activatedAt: new Date() },
    });
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
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: dto,
    });
  }

  /** Get reports for advertiser campaigns */
  async getReports(advertiserId: string, params: { campaignId?: string; from?: string; to?: string }) {
    const campaignWhere: Prisma.CampaignWhereInput = { advertiserId };
    if (params.campaignId) campaignWhere.id = params.campaignId;

    const campaigns = await this.prisma.campaign.findMany({
      where: campaignWhere,
      select: { id: true },
    });
    const campaignIds = campaigns.map((campaign) => campaign.id);

    const impressionTimeWhere: Pick<Prisma.AdImpressionWhereInput, 'createdAt'> = {};
    const clickTimeWhere: Pick<Prisma.AdClickWhereInput, 'createdAt'> = {};
    if (params.from || params.to) {
      const gte = params.from ? new Date(params.from) : undefined;
      const lte = params.to ? new Date(params.to) : undefined;
      // Reject malformed date strings up-front — `new Date("not a date")`
      // returns Invalid Date, which silently widens the query to "no lower
      // bound" or "no upper bound" depending on the field. The HTTP
      // controller already catches this; this guards non-HTTP callers.
      if (gte && Number.isNaN(gte.getTime())) {
        throw new BadRequestException(`Invalid 'from' date: ${params.from}`);
      }
      if (lte && Number.isNaN(lte.getTime())) {
        throw new BadRequestException(`Invalid 'to' date: ${params.to}`);
      }
      impressionTimeWhere.createdAt = { gte, lte };
      clickTimeWhere.createdAt = { gte, lte };
    }

    // Allow-list projections — never return sensitive internal fields
    // (impressionTokenHash, ipHash, idempotencyKey, deviceId, sessionId)
    // to advertisers. The report only needs performance metrics.
    const impressionSelect: Prisma.AdImpressionSelect = {
      id: true, campaignId: true, creativeId: true, userId: true,
      createdAt: true, renderedAt: true, qualifiedAt: true,
      visibleDurationMs: true, visibleSurface: true, isBillable: true,
      invalidationReason: true, invalidatedAt: true,
    };

    const clickSelect: Prisma.AdClickSelect = {
      id: true, impressionId: true, campaignId: true, userId: true,
      creativeId: true, clickedAt: true, targetUrl: true,
      isValid: true, invalidationReason: true, createdAt: true,
    };

    const [impressions, clicks] = await Promise.all([
      this.prisma.adImpression.findMany({
        where: { ...impressionTimeWhere, campaignId: { in: campaignIds }, isBillable: true },
        select: impressionSelect,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.adClick.findMany({
        where: { ...clickTimeWhere, campaignId: { in: campaignIds }, isValid: true },
        select: clickSelect,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    return { impressions, clicks };
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
}
