import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { MAX_AD_MESSAGE_LENGTH, PROHIBITED_CATEGORIES } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import {
  normalizeCreativeDestination,
  normalizeCreativeUpdate,
} from '../common/utils/external-url-policy';
import { PrismaService } from '../config/prisma.service';

const MAX_CREATIVES_PER_CAMPAIGN = 100;
const MAX_COUNTRY_TARGETS = 249;

/**
 * Actor carrying the caller's identity for ownership checks at the service
 * layer. Controllers pass this in; callers that don't authenticate (admin
 * jobs, internal callers) should pass `actor.role === 'admin'`.
 */
export interface ServiceActor {
  userId?: string;
  role?: string;
  /** Pre-resolved advertiser id for API-key machine-to-machine callers. */
  advertiserId?: string | null;
}

@Injectable()
export class CampaignService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ── Creative Management ──

  async createCreative(
    campaignId: string,
    dto: {
      title: string;
      sponsoredMessage: string;
      destinationUrl: string;
      displayDomain: string;
      ctaText?: string;
    },
    actor?: ServiceActor,
  ) {
    // Defense-in-depth ownership check — the controller is the primary gate,
    // but this service-layer check prevents internal/future callers from
    // creating creatives on any campaign without proving ownership.
    await this.assertCampaignOwnership(campaignId, actor);

    // Validate message length
    if (dto.sponsoredMessage.length > MAX_AD_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Sponsored message must be ${MAX_AD_MESSAGE_LENGTH} characters or fewer`,
      );
    }

    const creativeDestination = normalizeCreativeDestination(dto);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign-creatives:${campaignId}`}))`;
      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!campaign) throw new NotFoundException('Campaign not found');
      if (campaign.status !== 'draft' && campaign.status !== 'rejected') {
        throw new BadRequestException('Creatives can only be added to draft/rejected campaigns');
      }
      const creativeCount = await tx.adCreative.count({ where: { campaignId } });
      if (creativeCount >= MAX_CREATIVES_PER_CAMPAIGN) {
        throw new BadRequestException(
          `A campaign can contain at most ${MAX_CREATIVES_PER_CAMPAIGN} creatives`,
        );
      }
      const creative = await tx.adCreative.create({
        data: {
          campaignId,
          title: dto.title,
          sponsoredMessage: dto.sponsoredMessage,
          destinationUrl: creativeDestination.destinationUrl,
          displayDomain: creativeDestination.displayDomain,
          ctaText: dto.ctaText ?? null,
        },
      });

      await this.audit.logStrict(
        {
          actorId: actor?.userId ?? 'unknown',
          actorRole: actor?.role ?? 'advertiser',
          action: 'create_creative',
          targetType: 'creative',
          targetId: creative.id,
          beforeSnap: { campaignId },
        },
        tx,
      );
      return creative;
    });
  }

  async updateCreative(
    creativeId: string,
    dto: {
      title?: string;
      sponsoredMessage?: string;
      destinationUrl?: string;
      displayDomain?: string;
      ctaText?: string;
    },
    actor?: ServiceActor,
  ) {
    const creative = await this.prisma.adCreative.findUnique({ where: { id: creativeId } });
    if (!creative) throw new NotFoundException('Creative not found');

    // Defense-in-depth ownership check via the creative's parent campaign
    await this.assertCampaignOwnership(creative.campaignId, actor);

    if (dto.sponsoredMessage && dto.sponsoredMessage.length > MAX_AD_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Sponsored message must be ${MAX_AD_MESSAGE_LENGTH} characters or fewer`,
      );
    }

    const creativeDestination = normalizeCreativeUpdate(dto, creative.destinationUrl);

    // Updating a creative resets it to draft status for re-review
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.adCreative.update({
        where: { id: creativeId },
        data: {
          ...dto,
          ...creativeDestination,
          status: 'draft',
          rejectionReason: null,
        },
      });

      await this.audit.logStrict(
        {
          actorId: actor?.userId ?? 'unknown',
          actorRole: actor?.role ?? 'advertiser',
          action: 'update_creative',
          targetType: 'creative',
          targetId: creativeId,
          beforeSnap: { campaignId: creative.campaignId },
        },
        tx,
      );
      return updated;
    });
  }

  async getCreatives(campaignId: string, actor?: ServiceActor) {
    await this.assertCampaignOwnership(campaignId, actor);
    return this.prisma.adCreative.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      take: MAX_CREATIVES_PER_CAMPAIGN,
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
        const balance = await this.getAdvertiserBalance(campaign.advertiserId, campaign.currency);
        if (balance > 0) {
          // CAS-gated auto-activation: a concurrent archiveCampaign or
          // rejectCampaign could flip the status away from 'approved'
          // between our read and this write, and a plain `update` would
          // silently overwrite it — reactivating an archived/rejected
          // campaign whose unspent budget was meant to be refunded.
          const flip = await this.prisma.campaign.updateMany({
            where: { id: campaign.id, status: 'approved' },
            data: { status: 'active', activatedAt: new Date() },
          });
          campaignActivated = flip.count > 0;
        }
      }
    }

    // The controller's strict AuditInterceptor records the authenticated admin
    // actor. Do not emit a second hardcoded actorId='admin' row here: that
    // duplicate was misleading forensic evidence.

    return { creative: updated, campaignActivated };
  }

  /** Reject a creative with a reason */
  async rejectCreative(creativeId: string, reason: string) {
    const creative = await this.prisma.adCreative.findUnique({ where: { id: creativeId } });
    if (!creative) throw new NotFoundException('Creative not found');

    // A reviewer-supplied reason is required so the rejection is auditable and
    // advertiser-visible. Without this guard a creative could be rejected with
    // an empty placeholder, defeating A-045's "cannot reject without a reason".
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('A non-empty rejection reason is required');
    }

    const rejected = await this.prisma.adCreative.update({
      where: { id: creativeId },
      data: { status: 'rejected', rejectionReason: reason },
    });

    // Strict audit is provided by the controller interceptor with the real
    // reviewer identity; no duplicate service-level row.

    return rejected;
  }

  // ── Country Targeting ──

  async setCountryTargeting(
    campaignId: string,
    targets: Array<{ countryCode: string; include: boolean }>,
    actor?: ServiceActor,
  ) {
    if (targets.length > MAX_COUNTRY_TARGETS) {
      throw new BadRequestException(
        `Country targeting supports at most ${MAX_COUNTRY_TARGETS} ISO country entries`,
      );
    }
    await this.assertCampaignOwnership(campaignId, actor);
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    // Replace targeting and persist its audit row atomically.
    return this.prisma.$transaction(async (tx) => {
      await tx.countryTargeting.deleteMany({ where: { campaignId } });
      await tx.countryTargeting.createMany({
        data: targets.map((t) => ({
          campaignId,
          countryCode: t.countryCode.trim().toUpperCase(),
          include: t.include,
        })),
      });
      await this.audit.logStrict(
        {
          actorId: actor?.userId ?? 'unknown',
          actorRole: actor?.role ?? 'advertiser',
          action: 'set_country_targeting',
          targetType: 'campaign',
          targetId: campaignId,
          beforeSnap: { countryCount: targets.length },
        },
        tx,
      );
      return tx.countryTargeting.findMany({ where: { campaignId } });
    });
  }

  // ── Stats ──

  async getCampaignStats(campaignId: string, actor?: ServiceActor) {
    await this.assertCampaignOwnership(campaignId, actor);
    const [impressions, clicks, spend, campaign] = await Promise.all([
      this.prisma.adImpression.count({ where: { campaignId, isBillable: true } }),
      this.prisma.adClick.count({ where: { campaignId, isValid: true } }),
      this.prisma.advertiserLedger.aggregate({
        where: { campaignId, entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          name: true,
          status: true,
          budgetTotalMinor: true,
          budgetSpentMinor: true,
        },
      }),
    ]);

    return {
      campaign,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      spendMinor: spend._sum.amountMinor ?? 0n,
      budgetRemaining: campaign ? campaign.budgetTotalMinor - campaign.budgetSpentMinor : 0n,
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

  /**
   * Verify the caller owns the campaign. The controller-level verifier is
   * the primary gate; this service-layer check is defense-in-depth for any
   * internal/future caller that bypasses the controller — without it, an
   * advertiserId leak could be obtained by anyone who knows a campaignId.
   *
   * Admins and super_admins bypass the ownership check (support workflows).
   * For API-key machine-to-machine callers, the actor carries `advertiserId`
   * pre-resolved by the controller — the campaign's `advertiserId` must
   * match it exactly.
   *
   * When `actor` is omitted it's treated as an internal/system call; we
   * fail closed (forbid) so the contract is "you must prove who you are
   * OR be admin" rather than "everyone can read".
   */
  private async assertCampaignOwnership(campaignId: string, actor?: ServiceActor): Promise<void> {
    if (actor?.role === 'admin' || actor?.role === 'super_admin') return;

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { advertiserId: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    // API-key path: the actor already has an advertiserId set at key creation.
    if (actor?.advertiserId) {
      if (actor.advertiserId !== campaign.advertiserId) {
        throw new ForbiddenException('You do not own this campaign');
      }
      return;
    }

    // JWT path: resolve the caller's advertiser profile and compare.
    if (!actor?.userId) {
      throw new ForbiddenException('You do not own this campaign');
    }

    const advertiser = await this.prisma.advertiser.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!advertiser || advertiser.id !== campaign.advertiserId) {
      throw new ForbiddenException('You do not own this campaign');
    }
  }

  private getAdvertiserBalance(advertiserId: string, currency: string): Promise<bigint> {
    return getAdvertiserBalance(this.prisma, advertiserId, currency);
  }
}
