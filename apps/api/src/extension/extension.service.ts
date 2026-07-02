import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from '../ledger/ledger.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { FraudService } from '../fraud/fraud.service';
import * as crypto from 'crypto';
import { PROHIBITED_DATA_FIELDS, MINIMUM_VISIBLE_DURATION_MS, verifySignature } from '@waitlayer/shared';

@Injectable()
export class ExtensionService {
  private readonly hmacSecret: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
    private ledger: LedgerService,
    private fraud: FraudService,
  ) {
    this.hmacSecret = this.config.get<string>('EXTENSION_HMAC_SECRET', 'dev-secret-change-me');
  }

  // ── Device Registration ──

  async registerDevice(userId: string, dto: {
    toolType: string;
    fingerprintHash: string;
    extensionVersion?: string;
    platform?: string;
    publicKey?: string;
  }) {
    // Check for duplicate device (different user, same fingerprint = fraud signal)
    const existingDevice = await this.prisma.device.findUnique({
      where: { userId_fingerprintHash: { userId, fingerprintHash: dto.fingerprintHash } },
    });

    if (existingDevice) {
      return this.prisma.device.update({
        where: { id: existingDevice.id },
        data: {
          toolType: dto.toolType as any,
          extensionVersion: dto.extensionVersion,
          platform: dto.platform,
          lastSeenAt: new Date(),
        },
      });
    }

    // Check if this fingerprint is already used by another user
    const otherDevice = await this.prisma.device.findFirst({
      where: { fingerprintHash: dto.fingerprintHash, userId: { not: userId } },
    });

    const device = await this.prisma.device.create({
      data: {
        userId,
        fingerprintHash: dto.fingerprintHash,
        toolType: dto.toolType as any,
        extensionVersion: dto.extensionVersion,
        platform: dto.platform,
        publicKey: dto.publicKey,
      },
    });

    // If same fingerprint used by different user, create a fraud flag
    if (otherDevice) {
      await this.prisma.fraudFlag.create({
        data: {
          userId,
          deviceId: device.id,
          flagType: 'duplicate_device',
          severity: 'medium',
          evidence: {
            fingerprintHash: dto.fingerprintHash,
            otherUserId: otherDevice.userId,
            otherDeviceId: otherDevice.id,
          },
        },
      });

      // Audit log for security-sensitive duplicate device detection
      this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'duplicate_device_detected',
        targetType: 'device',
        targetId: device.id,
        afterSnap: { otherUserId: otherDevice.userId, fingerprintHash: dto.fingerprintHash },
      });
    }

    return device;
  }

  // ── Wait State Events ──

  async recordWaitStateStart(userId: string, dto: {
    deviceId: string;
    sessionId: string;
    toolType: string;
    waitStateId: string;
    idempotencyKey: string;
    signature: string;
  }) {
    // Idempotency: if we've seen this key, return the existing record
    const existing = await this.prisma.waitStateEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    // Verify device belongs to this user
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Device does not belong to this user');
    }

    // Verify HMAC signature
    const { signature: _, ...payload } = dto;
    if (!this.verifySignature(payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    return this.prisma.waitStateEvent.create({
      data: {
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        eventType: 'wait_state_start',
        waitStateId: dto.waitStateId,
        toolType: dto.toolType as any,
        signature: dto.signature,
        idempotencyKey: dto.idempotencyKey,
      },
    });
  }

  async recordWaitStateEnd(dto: {
    waitStateId: string;
    duration: string | number;
    idempotencyKey: string;
    signature: string;
  }) {
    // Idempotency
    const existing = await this.prisma.waitStateEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    // Verify HMAC signature
    const { signature: _, ...payload } = dto;
    if (!this.verifySignature(payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    const start = await this.prisma.waitStateEvent.findFirst({
      where: { waitStateId: dto.waitStateId, eventType: 'wait_state_start' },
      orderBy: { createdAt: 'desc' },
    });
    if (!start) throw new BadRequestException('No matching wait state start');

    const duration = typeof dto.duration === 'string' ? parseInt(dto.duration, 10) : dto.duration;
    if (isNaN(duration) || duration < 0) {
      throw new BadRequestException('Invalid duration value');
    }

    return this.prisma.waitStateEvent.create({
      data: {
        userId: start.userId,
        deviceId: start.deviceId,
        sessionId: start.sessionId,
        eventType: 'wait_state_end',
        waitStateId: dto.waitStateId,
        toolType: start.toolType,
        duration,
        signature: dto.signature,
        idempotencyKey: dto.idempotencyKey,
      },
    });
  }

  // ── Ad Serving ──

  async requestAd(userId: string, dto: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    toolType: string;
    allowedCategories?: string[];
    blockedCategories?: string[];
    idempotencyKey: string;
    signature: string;
  }) {
    // Enforce privacy: reject payloads containing prohibited data fields
    this.enforcePrivacy(dto as unknown as Record<string, unknown>);

    // Verify HMAC signature
    const { signature: _, ...payload } = dto;
    if (!this.verifySignature(payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Check user settings
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    if (settings && !settings.adsEnabled) {
      return { ad: null, reason: 'ads_disabled' };
    }

    // Verify device belongs to user
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Device does not belong to this user');
    }

    // Idempotency: return same ad if we already served one for this key
    // (we track by looking for an impression with this sessionId)
    const existingImpression = await this.prisma.adImpression.findFirst({
      where: { userId, sessionId: dto.sessionId },
      include: { campaign: true, creative: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existingImpression && Date.now() - existingImpression.createdAt.getTime() < 60_000) {
      // Return cached ad (don't count as new impression)
      const token = existingImpression.impressionTokenHash; // already hashed, can't return original
      return {
        ad: {
          campaignId: existingImpression.campaignId,
          creativeId: existingImpression.creativeId,
          message: existingImpression.creative?.sponsoredMessage,
          label: 'Sponsored',
          displayDomain: existingImpression.creative?.displayDomain,
          destinationUrl: existingImpression.creative?.destinationUrl,
          isCached: true,
        },
      };
    }

    // Build campaign query with frequency capping
    const maxPerHour = settings?.maxAdsPerHour ?? 6;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentImpressions = await this.prisma.adImpression.findMany({
      where: {
        userId,
        createdAt: { gte: oneHourAgo },
      },
      select: { campaignId: true },
    });

    const recentCampaignIds = [...new Set(recentImpressions.map((i: { campaignId: string }) => i.campaignId))];

    // Find active campaigns with approved creatives
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: 'active',
        id: { notIn: recentCampaignIds }, // Frequency cap: don't show same campaign within the hour
      },
      include: {
        creatives: {
          where: { status: 'approved' },
        },
        countryTargeting: true,
      },
      orderBy: { bidAmountMinor: 'desc' },
      take: 50,
    });

    // Filter by budget and category preferences
    const eligible = campaigns.filter((c: any) => {
      if (c.creatives.length === 0) return false;
      if (c.budgetSpentMinor >= c.budgetTotalMinor) return false;
      // Category filter
      if (dto.blockedCategories?.length && dto.blockedCategories.includes(c.category)) return false;
      if (dto.allowedCategories?.length && !dto.allowedCategories.includes(c.category)) return false;
      return true;
    });

    if (!eligible.length) {
      return { ad: null, reason: 'no_eligible_campaign' };
    }

    // Simple weighted selection (higher bid = higher chance)
    const totalBid = eligible.reduce((sum: number, c: any) => sum + c.bidAmountMinor, 0);
    let random = Math.random() * totalBid;
    let selected = eligible[0];
    for (const c of eligible) {
      random -= c.bidAmountMinor;
      if (random <= 0) { selected = c; break; }
    }

    const creative = selected.creatives[0];
    const impressionToken = crypto.randomUUID();
    const impressionTokenHash = crypto.createHash('sha256').update(impressionToken).digest('hex');

    // Create impression record
    await this.prisma.adImpression.create({
      data: {
        campaignId: selected.id,
        creativeId: creative.id,
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        impressionTokenHash,
      },
    });

    return {
      ad: {
        impressionToken,
        campaignId: selected.id,
        creativeId: creative.id,
        title: creative.title,
        message: creative.sponsoredMessage,
        label: 'Sponsored',
        displayDomain: creative.displayDomain,
        destinationUrl: creative.destinationUrl,
      },
    };
  }

  // ── Ad Event Tracking ──

  async recordRendered(dto: {
    impressionToken: string;
    renderedAt: string;
    visibleSurface?: number;
    idempotencyKey: string;
    signature: string;
  }) {
    // Verify HMAC signature
    const { signature: _, ...payload } = dto;
    if (!this.verifySignature(payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (impression.renderedAt) return impression; // Already recorded

    return this.prisma.adImpression.update({
      where: { id: impression.id },
      data: {
        renderedAt: new Date(dto.renderedAt),
        visibleSurface: dto.visibleSurface,
      },
    });
  }

  async recordQualifiedImpression(dto: {
    impressionToken: string;
    qualifiedAt: string;
    visibleDurationMs: number;
    idempotencyKey: string;
    signature: string;
  }) {
    // Verify HMAC signature
    const { signature: _, ...payload } = dto;
    if (!this.verifySignature(payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Must meet minimum visible duration
    if (dto.visibleDurationMs < MINIMUM_VISIBLE_DURATION_MS) {
      return {
        qualified: false,
        reason: 'minimum_duration_not_met',
        minimumRequired: MINIMUM_VISIBLE_DURATION_MS,
        actual: dto.visibleDurationMs,
      };
    }

    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
      include: {
        campaign: {
          select: { id: true, bidAmountMinor: true, currency: true, advertiserId: true, bidType: true },
        },
      },
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (impression.qualifiedAt) return { qualified: true, impressionId: impression.id, alreadyQualified: true };

    // Fraud check via rate limits
    const rateCheck = await this.fraud.checkImpressionRateLimit(
      impression.userId,
      impression.deviceId,
    );
    const isBillable = rateCheck.allowed;
    if (!isBillable) {
      // Record the impression as qualified but not billable — fraud was flagged
      await this.prisma.adImpression.update({
        where: { id: impression.id },
        data: {
          qualifiedAt: new Date(dto.qualifiedAt),
          visibleDurationMs: dto.visibleDurationMs,
          isBillable: false,
        },
      });
      return { qualified: false, impressionId: impression.id, reason: rateCheck.reason || 'fraud_detected' };
    }

    // Look up the user's trust level for hold days
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId: impression.userId } });
    const trustLevel = trustScore?.level || 'new';

    const split = this.ledger.calculateSplit(impression.campaign.bidAmountMinor);
    const holdDays = this.ledger.getHoldDays(trustLevel);
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `imp-${impression.id}`;

    // Single atomic transaction: impression update + all ledger entries + campaign spend
    await this.prisma.$transaction([
      // (1) Mark impression as billable qualified
      this.prisma.adImpression.update({
        where: { id: impression.id },
        data: {
          qualifiedAt: new Date(dto.qualifiedAt),
          visibleDurationMs: dto.visibleDurationMs,
          isBillable: true,
        },
      }),
      // (2) Debit advertiser balance
      this.prisma.advertiserLedger.create({
        data: {
          advertiserId: impression.campaign.advertiserId,
          campaignId: impression.campaignId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: impression.campaign.bidAmountMinor,
          currency: impression.campaign.currency,
          idempotencyKey: `${idempotencyBase}-adv`,
          description: `Impression ${impression.id} - campaign ${impression.campaignId}`,
        },
      }),
      // (3) Credit developer (estimated until hold expires)
      this.prisma.earningsLedger.create({
        data: {
          userId: impression.userId,
          campaignId: impression.campaignId,
          impressionId: impression.id,
          entryType: 'credit',
          status: 'estimated',
          amountMinor: split.userShare,
          currency: impression.campaign.currency,
          availableAt,
          idempotencyKey: `${idempotencyBase}-usr`,
          description: 'Earnings from qualified impression',
        },
      }),
      // (4) Credit platform fee
      this.prisma.platformLedger.create({
        data: {
          campaignId: impression.campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.platformShare,
          currency: impression.campaign.currency,
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          referenceId: impression.id,
          idempotencyKey: `${idempotencyBase}-plt`,
          description: 'Platform fee from impression',
        },
      }),
      // (5) Credit fraud/payment reserve
      this.prisma.platformLedger.create({
        data: {
          campaignId: impression.campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.reserveShare,
          currency: impression.campaign.currency,
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          referenceId: impression.id,
          idempotencyKey: `${idempotencyBase}-res`,
          description: 'Fraud/payment reserve from impression',
        },
      }),
      // (6) Increment campaign spend
      this.prisma.campaign.update({
        where: { id: impression.campaignId },
        data: { budgetSpentMinor: { increment: impression.campaign.bidAmountMinor } },
      }),
    ]);

    return { qualified: true, impressionId: impression.id };
  }

  async recordClick(dto: {
    impressionToken: string;
    clickedAt: string;
    idempotencyKey: string;
    signature: string;
  }) {
    // Verify HMAC signature
    const { signature: _, ...payload } = dto;
    if (!this.verifySignature(payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Idempotency check
    const existing = await this.prisma.adClick.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return { clicked: true, clickId: existing.id, isDuplicate: true };

    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
      include: {
        campaign: {
          select: { id: true, bidAmountMinor: true, currency: true, advertiserId: true, bidType: true },
        },
      },
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (!impression.qualifiedAt) throw new BadRequestException('Impression not yet qualified');

    // Fraud checks: rate + self-click
    const clickPatterns = await this.fraud.checkClickPatterns(impression.userId, impression.id);
    if (!clickPatterns.allowed) {
      return { clicked: false, reason: clickPatterns.reason || 'click_blocked' };
    }
    const selfClick = await this.fraud.checkSelfClick(impression.userId, impression.campaignId);
    if (!selfClick.allowed) {
      return { clicked: false, reason: selfClick.reason || 'self_click' };
    }

    // One click per impression
    const existingClick = await this.prisma.adClick.findFirst({
      where: { impressionId: impression.id },
    });
    if (existingClick) return { clicked: false, reason: 'duplicate_click' };

    // Find appropriate click bid (use campaign.cpcBid or default to campaign bid; CPC is the click-specific bid)
    // For CPC campaigns, the campaign.bidAmountMinor is the per-click bid.
    // For CPM campaigns, clicks don't earn — skip the ledger write.
    const isCpcBid = impression.campaign.bidType === 'cpc';

    // Trust level for hold days
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId: impression.userId } });
    const trustLevel = trustScore?.level || 'new';

    const holdDays = this.ledger.getHoldDays(trustLevel);
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const split = isCpcBid ? this.ledger.calculateSplit(impression.campaign.bidAmountMinor) : null;

    const operations: any[] = [
      // Create the click record
      this.prisma.adClick.create({
        data: {
          impressionId: impression.id,
          userId: impression.userId,
          deviceId: impression.deviceId,
          sessionId: impression.sessionId,
          campaignId: impression.campaignId,
          creativeId: impression.creativeId,
          clickedAt: new Date(dto.clickedAt),
          targetUrl: '',
          idempotencyKey: dto.idempotencyKey,
        },
      }),
    ];

    if (isCpcBid && split) {
      const idempotencyBase = `clk-${dto.idempotencyKey}`;
      // Add ledger entries for CPC campaigns
      operations.push(
        this.prisma.advertiserLedger.create({
          data: {
            advertiserId: impression.campaign.advertiserId,
            campaignId: impression.campaignId,
            entryType: 'debit',
            status: 'confirmed',
            amountMinor: impression.campaign.bidAmountMinor,
            currency: impression.campaign.currency,
            idempotencyKey: `${idempotencyBase}-adv`,
            description: `Click charge - campaign ${impression.campaignId}`,
          },
        }),
        this.prisma.earningsLedger.create({
          data: {
            userId: impression.userId,
            campaignId: impression.campaignId,
            impressionId: impression.id,
            entryType: 'credit',
            status: 'estimated',
            amountMinor: split.userShare,
            currency: impression.campaign.currency,
            availableAt,
            idempotencyKey: `${idempotencyBase}-usr`,
            description: 'Earnings from ad click',
          },
        }),
      );
    }

    const [click] = await this.prisma.$transaction(operations);

    return { clicked: true, clickId: click.id };
  }

  async reportAd(userId: string, dto: {
    impressionToken: string;
    reason: string;
    details?: string;
  }) {
    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
    });
    if (!impression) throw new NotFoundException('Impression not found');

    // Create report and invalidate the impression
    const [report] = await this.prisma.$transaction([
      this.prisma.adReport.create({
        data: {
          impressionId: impression.id,
          creativeId: impression.creativeId,
          userId,
          reason: dto.reason,
          details: dto.details,
        },
      }),
      this.prisma.adImpression.update({
        where: { id: impression.id },
        data: {
          isBillable: false,
          invalidationReason: `user_reported:${dto.reason}`,
          invalidatedAt: new Date(),
        },
      }),
    ]);

    // Audit log for ad report (security-relevant: impression invalidated)
    this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'report_ad',
      targetType: 'impression',
      targetId: impression.id,
      afterSnap: { reason: dto.reason, invalidated: true },
    });

    return report;
  }

  // ── HMAC Signature Verification ──

  verifySignature(payload: Record<string, unknown>, signature: string): boolean {
    return verifySignature(payload, this.hmacSecret, signature);
  }

  // ── Privacy Enforcement ──

  /** Reject any payload containing prohibited data fields */
  enforcePrivacy(payload: Record<string, unknown>): void {
    for (const field of PROHIBITED_DATA_FIELDS) {
      if (field in payload) {
        throw new ForbiddenException(`Prohibited field detected: ${field}. Privacy violation.`);
      }
    }
  }
}
