import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { BidType, Prisma, ToolTypeEnum } from '@waitlayer/db';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from '../ledger/ledger.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { FraudService } from '../fraud/fraud.service';
import * as crypto from 'crypto';
import { PROHIBITED_DATA_FIELDS, MINIMUM_VISIBLE_DURATION_MS, verifySignature } from '@waitlayer/shared';

interface ServedAd {
  impressionToken: string;
  campaignId: string;
  creativeId: string;
  title: string;
  message: string;
  label: string;
  displayDomain: string;
  destinationUrl: string;
}

@Injectable()
export class ExtensionService {
  private readonly hmacSecret: string;
  private adCache = new Map<string, { ad: ServedAd; timestamp: number }>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
    private ledger: LedgerService,
    private fraud: FraudService,
  ) {
    this.hmacSecret = this.config.get<string>('EXTENSION_HMAC_SECRET', 'dev-secret-change-me-do-not-use-in-production');
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
      // Re-registration rotates the per-device secret. Any leaked token from
      // the old extension install is invalidated by this one-time reveal.
      const rotatedSecret = crypto.randomBytes(32).toString('hex');
      const updated = await this.prisma.device.update({
        where: { id: existingDevice.id },
        data: {
          toolType: dto.toolType as ToolTypeEnum,
          extensionVersion: dto.extensionVersion,
          platform: dto.platform,
          eventSecret: rotatedSecret,
          lastSeenAt: new Date(),
        },
      });
      return { ...updated, eventSecret: rotatedSecret };
    }

    // Check if this fingerprint is already used by another user
    const otherDevice = await this.prisma.device.findFirst({
      where: { fingerprintHash: dto.fingerprintHash, userId: { not: userId } },
    });

    // Per-device HMAC secret: generated once at registration and revealed to
    // the client in the registration response. The client must persist it
    // locally (e.g. SecretStorage) and use it for every event signature.
    // Server-side verification resolves the device's secret from the lookup
    // its event belongs to, never from a single global env var. This prevents
    // a leaked global key from forging events for any device in the fleet.
    const eventSecret = crypto.randomBytes(32).toString('hex');

    const device = await this.prisma.device.create({
      data: {
        userId,
        fingerprintHash: dto.fingerprintHash,
        eventSecret,
        toolType: dto.toolType as ToolTypeEnum,
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

    return { ...device, eventSecret };
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
    // Verify device belongs to this user
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Device does not belong to this user');
    }

    // Verify HMAC signature with device-specific secret
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(dto.deviceId, payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Idempotency: only return an existing event after ownership/signature pass.
    const existing = await this.prisma.waitStateEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.deviceId !== dto.deviceId ||
        existing.waitStateId !== dto.waitStateId ||
        existing.eventType !== 'wait_state_start'
      ) {
        throw new ConflictException('Idempotency key already used');
      }
      return existing;
    }

    return this.prisma.waitStateEvent.create({
      data: {
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        eventType: 'wait_state_start',
        waitStateId: dto.waitStateId,
        toolType: dto.toolType as ToolTypeEnum,
        signature: dto.signature,
        idempotencyKey: dto.idempotencyKey,
      },
    });
  }

  async recordWaitStateEnd(userId: string, dto: {
    waitStateId: string;
    duration: string | number;
    idempotencyKey: string;
    signature: string;
  }) {
    // Resolve the start event FIRST so we can verify with the device's secret
    const start = await this.prisma.waitStateEvent.findFirst({
      where: { userId, waitStateId: dto.waitStateId, eventType: 'wait_state_start' },
      orderBy: { createdAt: 'desc' },
    });
    if (!start) throw new BadRequestException('No matching wait state start');
    if (start.userId !== userId) {
      throw new ForbiddenException('You do not own this wait state');
    }

    // Verify HMAC signature with device-specific secret
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(start.deviceId, payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Idempotency: only return an existing event after ownership/signature pass.
    const existing = await this.prisma.waitStateEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.waitStateId !== dto.waitStateId ||
        existing.eventType !== 'wait_state_end'
      ) {
        throw new ConflictException('Idempotency key already used');
      }
      return existing;
    }

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

    // Verify device belongs to user
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Device does not belong to this user');
    }

    // Verify HMAC signature with device-specific secret
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(dto.deviceId, payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Ad requests must happen during an authenticated user's active wait state.
    const waitStart = await this.prisma.waitStateEvent.findFirst({
      where: {
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        waitStateId: dto.waitStateId,
        eventType: 'wait_state_start',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!waitStart) {
      throw new BadRequestException('No matching active wait state start');
    }

    const waitEnd = await this.prisma.waitStateEvent.findFirst({
      where: {
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        waitStateId: dto.waitStateId,
        eventType: 'wait_state_end',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (waitEnd && waitEnd.createdAt >= waitStart.createdAt) {
      throw new BadRequestException('Wait state has already ended');
    }

    // Check user settings
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    if (settings && !settings.adsEnabled) {
      return { ad: null, reason: 'ads_disabled' };
    }
    if (
      settings?.quietMode &&
      this.isTimeInRange(
        this.currentTimeHHMM(),
        settings.quietModeStart || '22:00',
        settings.quietModeEnd || '08:00',
      )
    ) {
      return { ad: null, reason: 'quiet_mode' };
    }

    // Idempotency: return same ad if we already served one for this key/waitStateId
    const cached = this.adCache.get(dto.idempotencyKey) || this.adCache.get(dto.waitStateId);
    if (cached && Date.now() - cached.timestamp < 60_000) {
      return { ad: cached.ad };
    }

    // DB fallback check (e.g. process restarted)
    const existingImpression = await this.prisma.adImpression.findFirst({
      where: {
        userId,
        OR: [
          { idempotencyKey: dto.idempotencyKey },
          { waitStateId: dto.waitStateId }
        ]
      }
    });
    if (existingImpression) {
      throw new ConflictException('Ad already requested for this wait state');
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

    if (recentImpressions.length >= maxPerHour) {
      return { ad: null, reason: 'user_hourly_cap_reached' };
    }

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
    const eligible = campaigns.filter((c) => {
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
    const totalBid = eligible.reduce((sum, c) => sum + c.bidAmountMinor, 0);
    let random = Math.random() * totalBid;
    let selected = eligible[0];
    for (const c of eligible) {
      random -= c.bidAmountMinor;
      if (random <= 0) { selected = c; break; }
    }

    const creative = selected.creatives[0];
    const impressionToken = crypto.randomUUID();
    const impressionTokenHash = crypto.createHash('sha256').update(impressionToken).digest('hex');

    const ad = {
      impressionToken,
      campaignId: selected.id,
      creativeId: creative.id,
      title: creative.title,
      message: creative.sponsoredMessage,
      label: 'Sponsored',
      displayDomain: creative.displayDomain,
      destinationUrl: creative.destinationUrl,
    };

    // Create impression record
    await this.prisma.adImpression.create({
      data: {
        campaignId: selected.id,
        creativeId: creative.id,
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        impressionTokenHash,
        waitStateId: dto.waitStateId,
        idempotencyKey: dto.idempotencyKey,
      },
    });

    // Save to cache for immediate retries
    this.adCache.set(dto.idempotencyKey, { ad, timestamp: Date.now() });
    this.adCache.set(dto.waitStateId, { ad, timestamp: Date.now() });

    return { ad };
  }

  // ── Ad Event Tracking ──

  async recordRendered(userId: string, dto: {
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
    // Ownership: rendering must be initiated by the impression's owner. Without
    // this, a leaked impressionToken could be replayed by user A to mark user B's
    // impression as rendered (and short-circuit fraud-detection timeline checks).
    if (impression.userId !== userId) {
      throw new ForbiddenException('You do not own this impression');
    }

    // Verify HMAC signature against the device that requested this impression.
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    if (impression.renderedAt) return impression; // Already recorded

    return this.prisma.adImpression.update({
      where: { id: impression.id },
      data: {
        renderedAt: new Date(dto.renderedAt),
        visibleSurface: dto.visibleSurface,
      },
    });
  }

  async recordQualifiedImpression(userId: string, dto: {
    impressionToken: string;
    qualifiedAt: string;
    visibleDurationMs: number;
    idempotencyKey: string;
    signature: string;
  }) {
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
    // Ownership: billing events MUST be initiated by the impression's owner.
    // Otherwise the (advertiser debit + developer credit) would credit user B
    // for an impression requested by user A — a direct money-fraud vector.
    if (impression.userId !== userId) {
      throw new ForbiddenException('You do not own this impression');
    }

    // Verify HMAC signature against the device that requested this impression.
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature)) {
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

    if (impression.campaign.bidType === 'cpc') {
      const updated = await this.prisma.adImpression.update({
        where: { id: impression.id },
        data: {
          qualifiedAt: new Date(dto.qualifiedAt),
          visibleDurationMs: dto.visibleDurationMs,
          isBillable: true,
        },
      });
      return { qualified: true, impressionId: updated.id };
    }

    // Look up the user's trust level for hold days
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId: impression.userId } });
    const trustLevel = trustScore?.level || 'new';

    const split = this.ledger.calculateSplit(impression.campaign.bidAmountMinor);
    const holdDays = this.ledger.getHoldDays(trustLevel);
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `imp-${impression.id}`;

    // Single atomic transaction: impression update + all ledger entries + campaign spend.
    // The spend guard uses raw SQL UPDATE…WHERE so two concurrent CPM impressions
    // cannot both pass the JS pre-flight check and exceed budgetTotalMinor.
    // $executeRaw returns row count: 0 means the WHERE rejected (budget full).
    const billed = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // (0) Atomic spend increment — rejects when budget would overflow.
      const spent: number = await tx.$executeRawUnsafe(
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor"`,
        impression.campaign.bidAmountMinor,
        impression.campaignId,
      );
      if (spent === 0) return false; // budget exhausted — mark not billable below

      // (1) Mark impression as billable qualified
      await tx.adImpression.update({
        where: { id: impression.id },
        data: {
          qualifiedAt: new Date(dto.qualifiedAt),
          visibleDurationMs: dto.visibleDurationMs,
          isBillable: true,
        },
      });
      // (2) Debit advertiser balance
      await tx.advertiserLedger.create({
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
      });
      // (3) Credit developer (estimated until hold expires)
      await tx.earningsLedger.create({
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
      });
      // (4) Credit platform fee
      await tx.platformLedger.create({
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
      });
      // (5) Credit fraud/payment reserve
      await tx.platformLedger.create({
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
      });
      return true;
    });

    if (!billed) {
      await this.prisma.adImpression.update({
        where: { id: impression.id },
        data: { isBillable: false, invalidationReason: 'budget_exhausted' },
      });
      return { qualified: false, impressionId: impression.id, reason: 'budget_exhausted' };
    }

    return { qualified: true, impressionId: impression.id };
  }

  async recordClick(userId: string, dto: {
    impressionToken: string;
    clickedAt: string;
    idempotencyKey: string;
    signature: string;
  }) {
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
    // Ownership: clicks MUST be initiated by the impression's owner (the user who
    // saw the ad). Without this, an attacker who learns a token could credit
    // charges against any user's impression — direct money loss for the attacker
    // would not occur, but self-click-style fraud would be hidden and the
    // attacker could grief any campaign by spamming clicks.

    if (impression.userId !== userId) {
      throw new ForbiddenException('You do not own this impression');
    }

    // Verify HMAC signature against the device that requested this impression.
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Idempotency check: a duplicate is valid only for the same user+impression.
    const existing = await this.prisma.adClick.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (existing.userId !== userId || existing.impressionId !== impression.id) {
        throw new ConflictException('Idempotency key already used');
      }
      return { clicked: true, clickId: existing.id, isDuplicate: true };
    }

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
    const isCpcBid = impression.campaign.bidType === BidType.cpc;

    // Trust level for hold days
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId: impression.userId } });
    const trustLevel = trustScore?.level || 'new';

    const holdDays = this.ledger.getHoldDays(trustLevel);
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const split = isCpcBid ? this.ledger.calculateSplit(impression.campaign.bidAmountMinor) : null;

    let click: { id: string };
    try {
      click = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const click = await tx.adClick.create({
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

        if (isCpcBid && split) {
          // Atomic budget guard for CPC clicks — same pattern as CPM above.
          const spent: number = await tx.$executeRawUnsafe(
            `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor"`,
            impression.campaign.bidAmountMinor,
            impression.campaignId,
          );
          if (spent === 0) {
            throw new ConflictException('Campaign budget exhausted');
          }

          const idempotencyBase = `clk-${click.id}`;
          await tx.advertiserLedger.create({
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
          });
          await tx.earningsLedger.create({
            data: {
              userId: impression.userId,
              campaignId: impression.campaignId,
              impressionId: impression.id,
              clickId: click.id,
              entryType: 'credit',
              status: 'estimated',
              amountMinor: split.userShare,
              currency: impression.campaign.currency,
              availableAt,
              idempotencyKey: `${idempotencyBase}-usr`,
              description: 'Earnings from ad click',
            },
          });
          await tx.platformLedger.create({
            data: {
              campaignId: impression.campaignId,
              entryType: 'credit',
              status: 'confirmed',
              amountMinor: split.platformShare,
              currency: impression.campaign.currency,
              bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
              referenceId: click.id,
              idempotencyKey: `${idempotencyBase}-plt`,
              description: 'Platform fee from ad click',
            },
          });
          await tx.platformLedger.create({
            data: {
              campaignId: impression.campaignId,
              entryType: 'credit',
              status: 'confirmed',
              amountMinor: split.reserveShare,
              currency: impression.campaign.currency,
              bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
              referenceId: click.id,
              idempotencyKey: `${idempotencyBase}-res`,
              description: 'Fraud/payment reserve from ad click',
            },
          });
        }

        return click;
      });
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        return { clicked: false, reason: 'duplicate_click' };
      }
      throw error;
    }

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
    if (impression.userId !== userId) {
      throw new ForbiddenException('You do not own this impression');
    }

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

  /** Verify an event payload signature using the device-specific secret.
   *  Global HMAC is accepted ONLY when the device does not yet have
   *  an issued eventSecret. Once a device has a per-device secret the global
   *  key no longer authorizes events for that device — even if the device
   *  secret fails to match. This prevents the global-secret bypass where
   *  knowing the fallback key forges events for every device. */
  async verifyDeviceSignature(deviceId: string | null, payload: Record<string, unknown>, signature: string): Promise<boolean> {
    // Try device-specific secret first
    if (deviceId) {
      const device = await this.prisma.device.findUnique({
        where: { id: deviceId },
        select: { eventSecret: true },
      });
      if (device?.eventSecret) {
        // Device has a dedicated secret — ONLY accept the device secret.
        // The global fallback is NEVER accepted for a device that has its
        // own secret. Return the result directly (true or false), no
        // further fallback.
        return verifySignature(payload, device.eventSecret, signature);
      }
    }
    // Fallback: global HMAC secret for legacy device rows that never
    // received an eventSecret, or for anonymous (no device) calls.
    return verifySignature(payload, this.hmacSecret, signature);
  }

  /** Deprecated: use verifyDeviceSignature instead. Kept for tests. */
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

  private currentTimeHHMM(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  private isTimeInRange(now: string, start: string, end: string): boolean {
    if (start <= end) {
      return now >= start && now <= end;
    }
    return now >= start || now <= end;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
