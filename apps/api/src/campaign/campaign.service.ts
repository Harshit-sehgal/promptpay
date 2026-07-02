import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { MAX_AD_MESSAGE_LENGTH, PROHIBITED_CATEGORIES } from '@waitlayer/shared';

@Injectable()
export class CampaignService {
  constructor(private prisma: PrismaService) {}

  // ── Creative Management ──

  async createCreative(campaignId: string, dto: {
    title: string;
    sponsoredMessage: string;
    destinationUrl: string;
    displayDomain: string;
  }) {
    // Validate message length
    if (dto.sponsoredMessage.length > MAX_AD_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Sponsored message must be ${MAX_AD_MESSAGE_LENGTH} characters or fewer`,
      );
    }

    // Verify campaign exists and is in draft
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'draft' && campaign.status !== 'rejected') {
      throw new BadRequestException('Creatives can only be added to draft/rejected campaigns');
    }

    return this.prisma.adCreative.create({
      data: {
        campaignId,
        title: dto.title,
        sponsoredMessage: dto.sponsoredMessage,
        destinationUrl: dto.destinationUrl,
        displayDomain: dto.displayDomain,
      },
    });
  }

  async updateCreative(creativeId: string, dto: {
    title?: string;
    sponsoredMessage?: string;
    destinationUrl?: string;
    displayDomain?: string;
  }) {
    const creative = await this.prisma.adCreative.findUnique({ where: { id: creativeId } });
    if (!creative) throw new NotFoundException('Creative not found');

    if (dto.sponsoredMessage && dto.sponsoredMessage.length > MAX_AD_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Sponsored message must be ${MAX_AD_MESSAGE_LENGTH} characters or fewer`,
      );
    }

    // Updating a creative resets it to draft status for re-review
    return this.prisma.adCreative.update({
      where: { id: creativeId },
      data: {
        ...dto,
        status: 'draft',
        rejectionReason: null,
      },
    });
  }

  async getCreatives(campaignId: string) {
    return this.prisma.adCreative.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Creative Approval ──

  /** Approve a creative for serving — only admin or system should call this */
  async approveCreative(creativeId: string) {
    const creative = await this.prisma.adCreative.findUnique({ where: { id: creativeId } });
    if (!creative) throw new NotFoundException('Creative not found');

    const updated = await this.prisma.adCreative.update({
      where: { id: creativeId },
      data: { status: 'approved', rejectionReason: null },
    });

    // Check if the campaign is 'approved' and now has at least one approved creative and has budget remaining
    // If so, auto-activate the campaign so it can serve ads
    let campaignActivated = false;
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: creative.campaignId },
      include: { creatives: { where: { status: 'approved' } } },
    });
    if (campaign && campaign.status === 'approved' && campaign.creatives.length > 0) {
      const hasBudget = campaign.budgetSpentMinor < campaign.budgetTotalMinor;
      if (hasBudget) {
        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'active', activatedAt: new Date() },
        });
        campaignActivated = true;
      }
    }

    return { creative: updated, campaignActivated };
  }

  /** Reject a creative with a reason */
  async rejectCreative(creativeId: string, reason: string) {
    const creative = await this.prisma.adCreative.findUnique({ where: { id: creativeId } });
    if (!creative) throw new NotFoundException('Creative not found');

    return this.prisma.adCreative.update({
      where: { id: creativeId },
      data: { status: 'rejected', rejectionReason: reason },
    });
  }

  // ── Country Targeting ──

  async setCountryTargeting(campaignId: string, targets: Array<{ countryCode: string; include: boolean }>) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    // Replace all targeting
    await this.prisma.$transaction([
      this.prisma.countryTargeting.deleteMany({ where: { campaignId } }),
      this.prisma.countryTargeting.createMany({
        data: targets.map(t => ({ campaignId, countryCode: t.countryCode, include: t.include })),
      }),
    ]);

    return this.prisma.countryTargeting.findMany({ where: { campaignId } });
  }

  // ── Stats ──

  async getCampaignStats(campaignId: string) {
    const [impressions, clicks, spend, campaign] = await Promise.all([
      this.prisma.adImpression.count({ where: { campaignId, isBillable: true } }),
      this.prisma.adClick.count({ where: { campaignId, isValid: true } }),
      this.prisma.advertiserLedger.aggregate({
        where: { campaignId, entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, name: true, status: true, budgetTotalMinor: true, budgetSpentMinor: true },
      }),
    ]);

    return {
      campaign,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      spendMinor: spend._sum.amountMinor || 0,
      budgetRemaining: campaign ? campaign.budgetTotalMinor - campaign.budgetSpentMinor : 0,
    };
  }

  // ── Campaign Category Validation ──

  async validateCampaignCategory(category: string) {
    if ((PROHIBITED_CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException(`Category "${category}" is prohibited`);
    }

    const blocked = await this.prisma.blockedCategory.findFirst({
      where: { category: { slug: category } },
    });
    if (blocked) {
      throw new BadRequestException(`Category "${category}" is blocked: ${blocked.reason}`);
    }
  }
}
