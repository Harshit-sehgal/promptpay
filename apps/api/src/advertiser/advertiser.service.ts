import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { BidType, Prisma } from '@waitlayer/db';
import { PrismaService } from '../config/prisma.service';
import { CampaignService } from '../campaign/campaign.service';
import { CampaignStatus, AD_SERVING } from '@waitlayer/shared';

/** Valid campaign status transitions */
const CAMPAIGN_TRANSITIONS: Record<string, CampaignStatus[]> = {
  draft: ['submitted'] as CampaignStatus[],
  submitted: ['approved', 'rejected'] as CampaignStatus[],
  approved: ['active', 'rejected'] as CampaignStatus[],
  active: ['paused'] as CampaignStatus[],
  paused: ['active'] as CampaignStatus[],
  rejected: ['draft'] as CampaignStatus[],
  archived: [] as CampaignStatus[],
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
      data: { userId, companyName: user.name || 'Unnamed Company', billingEmail: user.email },
    });
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
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: dto,
    });
  }

  /** Get reports for advertiser campaigns */
  async getReports(advertiserId: string, params: { campaignId?: string; from?: string; to?: string }) {
    const where: Prisma.AdImpressionWhereInput = {};
    if (params.campaignId) where.campaignId = params.campaignId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }

    const [impressions, clicks] = await Promise.all([
      this.prisma.adImpression.findMany({
        where: { ...where, campaign: { advertiserId }, isBillable: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.adClick.findMany({
        where: { ...where, campaign: { advertiserId }, isValid: true },
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
