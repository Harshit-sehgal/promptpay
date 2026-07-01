import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CampaignStatus, AD_SERVING } from '@waitlayer/shared';

/** Valid campaign status transitions */
const CAMPAIGN_TRANSITIONS: Record<string, CampaignStatus[]> = {
  draft: ['submitted'] as CampaignStatus[],
  submitted: ['approved', 'rejected'] as CampaignStatus[],
  approved: ['active', 'rejected'] as CampaignStatus[],
  active: ['paused'] as CampaignStatus[],
  paused: ['approved'] as CampaignStatus[],
  rejected: ['draft'] as CampaignStatus[],
  archived: [] as CampaignStatus[],
};

@Injectable()
export class AdvertiserService {
  constructor(private prisma: PrismaService) {}

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
      select: { id: true, name: true, status: true, bidType: true, bidAmountMinor: true, budgetTotalMinor: true, budgetSpentMinor: true, currency: true, createdAt: true },
    });

    const totalImpressions = await this.prisma.adImpression.count({
      where: { campaign: { advertiserId }, isBillable: true },
    });

    const totalClicks = await this.prisma.adClick.count({
      where: { campaignId: { in: campaigns.map(c => c.id) }, isValid: true },
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
      activeCampaigns: campaigns.filter(c => c.status === 'active').length,
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

    return this.prisma.campaign.create({
      data: {
        advertiserId,
        name: dto.name,
        category: dto.category,
        bidType: dto.bidType as any,
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

    // Must have at least one approved creative
    if (campaign.creatives.filter(c => c.status === 'approved').length === 0 && campaign.creatives.length === 0) {
      throw new BadRequestException('Campaign must have at least one creative before submission');
    }

    this.validateTransition(campaign.status, 'submitted');

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
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.advertiserId !== advertiserId) throw new ForbiddenException();
    this.validateTransition(campaign.status, 'approved');
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'approved', pausedAt: null },
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
    const where: any = {};
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
