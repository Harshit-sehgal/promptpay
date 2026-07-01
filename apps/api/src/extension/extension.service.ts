import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PROHIBITED_DATA_FIELDS, MINIMUM_VISIBLE_DURATION_MS } from '@waitlayer/shared';

@Injectable()
export class ExtensionService {
  private readonly hmacSecret: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
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
        budgetSpentMinor: { lt: this.prisma.campaign.fields.budgetTotalMinor }, // Budget check
      },
      include: {
        creatives: {
          where: { status: 'approved' },
        },
        countryTargeting: true,
      },
      orderBy: { bidAmountMinor: 'desc' },
      take: 20,
    });

    // Filter by category preferences and budget
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
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (impression.qualifiedAt) return { qualified: true, impressionId: impression.id, alreadyQualified: true };

    await this.prisma.adImpression.update({
      where: { id: impression.id },
      data: {
        qualifiedAt: new Date(dto.qualifiedAt),
        visibleDurationMs: dto.visibleDurationMs,
        isBillable: true,
      },
    });

    return { qualified: true, impressionId: impression.id };
  }

  async recordClick(dto: {
    impressionToken: string;
    clickedAt: string;
    idempotencyKey: string;
    signature: string;
  }) {
    // Idempotency check
    const existing = await this.prisma.adClick.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return { clicked: true, clickId: existing.id, isDuplicate: true };

    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (!impression.qualifiedAt) throw new BadRequestException('Impression not yet qualified');

    // One click per impression
    const existingClick = await this.prisma.adClick.findFirst({
      where: { impressionId: impression.id },
    });
    if (existingClick) return { clicked: false, reason: 'duplicate_click' };

    const click = await this.prisma.adClick.create({
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
    });

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
    // Sort payload keys for deterministic signing
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const expected = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(canonical)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
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
