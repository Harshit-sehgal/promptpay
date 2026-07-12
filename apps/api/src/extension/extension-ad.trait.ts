import * as crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { BidType, Prisma } from '@waitlayer/db';
import { MINIMUM_VISIBLE_DURATION_MS } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';
import {
  getAdvertiserBalance,
  getAdvertiserBalancesByCurrency,
} from '../common/utils/advertiser-balance';
import { isSerializationError, isUniqueConstraintViolation } from '../common/utils/errors';
import { normalizeCreativeDestination } from '../common/utils/external-url-policy';
import { ComplianceService } from '../compliance/compliance.service';
import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { isCountryEligible, normalizeCountryCode } from './country-targeting';
import {
  adCacheKey,
  adIdempotencyCacheKey,
  AdvertiserBalanceExhaustedError,
  advertiserCurrencyLockKey,
  BudgetExhaustedError,
  FREQUENCY_CAP_TXN_MAX_RETRIES,
  isCategoryBlocked,
  mergeBlockedCategories,
  ServedAd,
} from './extension.constants';
import type { ExtensionService } from './extension.service';
import { ExtensionDeviceReportTrait } from './extension-device-report.trait';
import { isUnderFrequencyCap } from './frequency-cap';
import { formatHHMMInZone, isTimeInRange } from './quiet-hours';

export class ExtensionAdTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare ledger: LedgerService;
  declare fraud: FraudService;
  declare compliance: ComplianceService;
  declare adCache: LRUCache<string, { ad: ServedAd }>;
  declare logger: Logger;

  // ── Ad Serving ──
  async requestAd(
    userId: string,
    dto: {
      deviceId: string;
      sessionId: string;
      waitStateId: string;
      toolType: string;
      allowedCategories?: string[];
      blockedCategories?: string[];
      country?: string;
      idempotencyKey: string;
      signature: string;
    },
  ) {
    // Enforce privacy: reject payloads containing prohibited data fields
    this.enforcePrivacyOn(dto);
    // Verify device belongs to user
    const device = await this.prisma.device.findUnique({
      where: { id: dto.deviceId },
      include: { user: { select: { status: true } } },
    });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Device does not belong to this user');
    }
    if (!isActiveAccountStatus(device.user.status)) {
      return { ad: null, reason: 'account_not_active' };
    }
    // A-036: Authenticated users who have recorded an account-level CCPA opt-out
    // must not receive targeted/sold ad impressions. A logged-out opt-out stored
    // device-local only is NOT enforced here (there is no userId to check), but
    // the privacy page tells those visitors the preference is local-only.
    const ccpaOptedOut = await this.compliance.isConsented(userId, 'ccpa_opt_out');
    if (ccpaOptedOut) {
      void this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'ccpa_opt_out_enforced',
        targetType: 'ad_request',
        targetId: userId,
        afterSnap: { reason: 'ad_not_served_ccpa_opt_out' },
      });
      return { ad: null, reason: 'ccpa_opt_out' };
    }
    // Verify HMAC signature with device-specific secret
    const { signature: _, ...payload } = dto;
    if (!(await this.verifyDeviceSignature(dto.deviceId, payload, dto.signature))) {
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
      isTimeInRange(
        // A-058: evaluate quiet mode in the developer's stored IANA timezone
        // instead of the API server's local timezone. When the developer has
        // not set a timezone, fall back to UTC (deterministic and UTC never
        // observes DST — same wall-clock reading for the same instant).
        formatHHMMInZone(new Date(), settings?.timezone ?? 'UTC'),
        settings.quietModeStart || '22:00',
        settings.quietModeEnd || '08:00',
      )
    ) {
      return { ad: null, reason: 'quiet_mode' };
    }
    // A-057: merge the developer's PERSISTED blocked categories (stored on
    // UserSettings) with any per-request client-supplied arrays. Server-side
    // enforcement is the source of truth — an omission on the client cannot
    // relax a developer preference. Union the two blocked sets so a category
    // blocked on either side is excluded. We DO NOT union `allowedCategories`
    // (there is no persisted allow-list, only the per-request client filter);
    // persisted preferences can only further RESTRICT delivery, never widen it.
    const persistedBlocked = settings?.blockedCategories ?? [];
    const effectiveBlocked = mergeBlockedCategories(persistedBlocked, dto.blockedCategories);
    // A-056: resolve the requesting developer's country for country-targeting
    // enforcement. Prefer the client-supplied value (privacy-safe developer
    // opt-in, no server geolocation), then fall back to the profile country.
    const userCountry =
      normalizeCountryCode(dto.country) ??
      (await this.prisma.user
        .findUnique({ where: { id: userId }, select: { country: true } })
        .then((u) => normalizeCountryCode(u?.country)));
    // Idempotency: return same ad if we already served one for this
    // user/device/waitStateId. Keys are NAMESPACED by userId + deviceId so two
    // different users who collide on a client-generated waitStateId or
    // idempotencyKey cannot receive each other's served ad / impression token
    // (issue A-038).
    const cached =
      this.adCache.get(adIdempotencyCacheKey(userId, dto.deviceId, dto.idempotencyKey)) ??
      this.adCache.get(adCacheKey(userId, dto.deviceId, dto.waitStateId));
    if (cached) {
      return { ad: cached.ad };
    }
    // Build campaign query with frequency capping
    const maxPerHour = settings?.maxAdsPerHour ?? 6;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Find active campaigns with approved creatives (outside the critical
    // section — read-mostly data, no contention).
    const recentBillableCampaignIds = await this.recentBillableCampaignIds(userId, oneHourAgo);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Per-campaign frequency-cap accounting (issue A-061). Count this user's
    // served impressions for every candidate campaign within the trailing hour
    // and day, then exclude campaigns that have already hit their configured
    // cap. We count ALL impressions (billable or not) because the cap governs
    // ad exposure, not billing.
    const recentImpressions = await this.prisma.adImpression.findMany({
      where: { userId, createdAt: { gte: oneDayAgo } },
      select: { campaignId: true, createdAt: true },
    });
    const campaignHourCounts = new Map<string, number>();
    const campaignDayCounts = new Map<string, number>();
    for (const imp of recentImpressions) {
      if (imp.createdAt >= oneHourAgo) {
        campaignHourCounts.set(imp.campaignId, (campaignHourCounts.get(imp.campaignId) ?? 0) + 1);
      }
      campaignDayCounts.set(imp.campaignId, (campaignDayCounts.get(imp.campaignId) ?? 0) + 1);
    }
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: 'active',
        id: { notIn: recentBillableCampaignIds }, // Frequency cap: don't show same campaign within the hour
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
    // Filter by budget, category preferences, and URL safety. The write path
    // validates new creatives, but this keeps older approved DB rows from
    // being served if they predate the policy or were imported manually.
    const campaignsWithSafeCreatives = campaigns.map((c) => ({
      ...c,
      creatives: c.creatives.flatMap((creative) => {
        try {
          const normalized = normalizeCreativeDestination(creative);
          return [{ ...creative, ...normalized }];
        } catch (err) {
          this.logger.warn(
            `Skipping unsafe creative ${creative.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      }),
    }));
    const initialEligible = campaignsWithSafeCreatives.filter((c) => {
      if (c.creatives.length === 0) return false;
      if (BigInt(c.budgetSpentMinor) >= BigInt(c.budgetTotalMinor)) return false;
      // Category filter
      if (isCategoryBlocked(effectiveBlocked, c.category)) return false;
      if (dto.allowedCategories?.length && !dto.allowedCategories.includes(c.category))
        return false;
      // Country-targeting filter (issue A-056). Campaigns with no targeting
      // rows serve everywhere; include-lists restrict to listed countries and
      // exclude-lists block listed countries.
      if (!isCountryEligible(c, userCountry)) return false;
      // Per-campaign frequency caps (issue A-061). A cap of 0/undefined means
      // "no limit"; a positive cap is enforced against the user's served
      // impressions in the trailing hour and day.
      if (
        !isUnderFrequencyCap(c, campaignHourCounts.get(c.id) ?? 0, campaignDayCounts.get(c.id) ?? 0)
      ) {
        return false;
      }
      return true;
    });
    if (!initialEligible.length) {
      return { ad: null, reason: 'no_eligible_campaign' };
    }
    // Filter by per-currency advertiser balance (issue A-039). Each campaign is
    // compared against its OWN currency balance, so an advertiser with plenty of
    // EUR but zero USD cannot serve a USD campaign.
    const advertiserIds = initialEligible.map((c) => c.advertiserId);
    const advertiserBalances = await getAdvertiserBalancesByCurrency(this.prisma, advertiserIds);
    const eligible = initialEligible.filter((c) => {
      const balance = BigInt(advertiserBalances.get(`${c.advertiserId}:${c.currency}`) ?? 0);
      return balance >= BigInt(c.bidAmountMinor);
    });
    if (!eligible.length) {
      return { ad: null, reason: 'no_eligible_campaign' };
    }
    // Weighted selection by bid. If every eligible campaign has bid 0 the
    // weighted RNG collapses to "always pick the first" — which is OK as
    // long as eligible is non-empty, but falls through here only when
    // totalBid happens to round to zero. In that case pick uniformly to
    // avoid deterministic over-serving of the first campaign encountered.
    const totalBid = eligible.reduce((sum, c) => sum + BigInt(c.bidAmountMinor), 0n);
    let selected: (typeof eligible)[number];
    if (totalBid === 0n) {
      selected = eligible[Math.floor(Math.random() * eligible.length)];
    } else {
      let random = BigInt(Math.floor(Math.random() * Number(totalBid)));
      selected = eligible[0];
      for (const c of eligible) {
        random -= BigInt(c.bidAmountMinor);
        if (random <= 0n) {
          selected = c;
          break;
        }
      }
      // Defensive fallback: float-rounding drift in the loop above can
      // leave `random` slightly above zero for the highest-bid campaign.
      // Pick it explicitly so we never serve an undefined ad.
      selected = selected ?? eligible[eligible.length - 1];
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
      ctaText: creative.ctaText ?? null,
    };
    // ── Atomic claim ──
    // The cap-check + impression insert must be atomic against concurrent
    // ad-requests on the same user. Without a transaction, two in-flight
    // requests both count "5 so far" and both insert → 7 impressions for a
    // cap of 6. We use a serializable transaction guarded by a per-user
    // Postgres advisory lock; the lock short-circuits serialization conflicts
    // because only one transaction per user runs the critical section at a
    // time. On a P2034/serialization failure we retry the whole claim.
    let claim: Awaited<ReturnType<ExtensionService['claimImpression']>>;
    let attempt = 0;
    for (;;) {
      try {
        claim = await this.claimImpression({
          userId,
          deviceId: dto.deviceId,
          sessionId: dto.sessionId,
          waitStateId: dto.waitStateId,
          idempotencyKey: dto.idempotencyKey,
          campaignId: selected.id,
          creativeId: creative.id,
          impressionTokenHash,
          maxPerHour,
          oneHourAgo,
        });
        break;
      } catch (err) {
        if (isSerializationError(err) && ++attempt < FREQUENCY_CAP_TXN_MAX_RETRIES) {
          continue;
        }
        throw err;
      }
    }
    if (claim.status === 'duplicate') {
      throw new ConflictException('Ad already requested for this wait state');
    }
    if (claim.status === 'cap_reached') {
      return { ad: null, reason: 'user_hourly_cap_reached' };
    }
    // Save to LRU cache for immediate retries. Both keys map to the same ad
    // so a retry on either lookup hits the bounded cache. LRU's TTL evicts
    // these after 60s — older than that there's no valid request anymore.
    // Keys are namespaced by userId + deviceId (issue A-038).
    this.adCache.set(adIdempotencyCacheKey(userId, dto.deviceId, dto.idempotencyKey), { ad });
    this.adCache.set(adCacheKey(userId, dto.deviceId, dto.waitStateId), { ad });
    // Audit log on every billable ad served. This is the platform's most
    // sensitive money-flow and forensics here directly supports fraud
    // detection (burst-detection on a single device/user) plus dispute
    // resolution. claim.impressionId is the FK into ad_impression, the
    // authoritative record linking the served ad to a downstream click /
    // impression-qualified outcome. Fire-and-forget via audit.log().
    if (claim.status === 'claimed' && claim.impressionId) {
      void this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'ad_served',
        targetType: 'impression',
        targetId: claim.impressionId,
        afterSnap: {
          campaignId: selected.id,
          creativeId: creative.id,
          deviceId: dto.deviceId,
          waitStateId: dto.waitStateId,
        },
      });
    }
    return { ad };
  }

  /**
   * Read the set of distinct campaigns already successfully shown (billable)
   * to this user in the last hour, used as a pre-filter so we don't re-offer a
   * campaign the user was just billed for. This is a campaign-de-dup read, NOT
   * the developer hourly cap — the authoritative maxAdsPerHour gate lives in
   * claimImpression's serializable transaction (issue A-061), where it counts
   * every served impression regardless of billable status. Read outside the
   * critical section: it's read-mostly and the authoritative cap gate lives
   * in claimImpression's transaction.
   */
  async recentBillableCampaignIds(userId: string, oneHourAgo: Date): Promise<string[]> {
    const recent = await this.prisma.adImpression.findMany({
      where: { userId, isBillable: true, createdAt: { gte: oneHourAgo } },
      select: { campaignId: true },
    });
    return [...new Set(recent.map((i: { campaignId: string }) => i.campaignId))];
  }

  /**
   * Atomically: reject duplicate idempotency/waitState, enforce the hourly
   * cap, and persist the new impression. Runs under a serializable transaction
   * + per-user advisory lock so concurrent ad-requests serialize per user —
   * the cap can never be exceeded by a count-then-insert race.
   *
   * Returns one of:
   *   - { status: 'claimed', impressionId }              (impression created)
   *   - { status: 'duplicate' }                          (idempotency/waitState already claimed)
   *   - { status: 'cap_reached' }                        (user_hourly_cap_reached)
   */
  async claimImpression(args: {
    userId: string;
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    idempotencyKey: string;
    campaignId: string;
    creativeId: string;
    impressionTokenHash: string;
    maxPerHour: number;
    oneHourAgo: Date;
  }): Promise<
    | {
        status: 'claimed';
        impressionId: string;
      }
    | {
        status: 'duplicate';
      }
    | {
        status: 'cap_reached';
      }
  > {
    return this.prisma.$transaction(
      async (tx) => {
        // Per-user advisory lock. Hash the userId (a UUID string) into a
        // 32-bit bigint key for pg_advisory_xact_lock — collisions are
        // acceptable; two users hashing to the same key just queue briefly.
        const lockKey = BigInt(
          '0x' + crypto.createHash('sha256').update(args.userId).digest('hex').slice(0, 8),
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
        // Idempotency check inside the lock — an earlier-arrived request
        // that INSERTed before we acquired the lock is now visible, so we
        // detect it here rather than racing the cap.
        const existing = await tx.adImpression.findFirst({
          where: {
            userId: args.userId,
            OR: [{ idempotencyKey: args.idempotencyKey }, { waitStateId: args.waitStateId }],
          },
          select: { id: true },
        });
        if (existing) return { status: 'duplicate' as const };
        // Authoritative cap count inside the lock (issue A-061). The developer
        // `maxAdsPerHour` setting is an AD EXPOSURE cap, not a billing cap, so it
        // counts every impression we have SERVED in the trailing hour —
        // billable or not. Counting only `isBillable: true` here let a rapid
        // burst of concurrent wait states each pass the cap (none had
        // qualified/become-billable yet) and over-serve past the user's selected
        // max. Fraud/budget-rejected impressions still "count" as ad exposure
        // from the user's perspective; that's the contract the setting
        // describes. The advisory lock makes this count-then-insert atomic.
        const recentCount = await tx.adImpression.count({
          where: {
            userId: args.userId,
            createdAt: { gte: args.oneHourAgo },
          },
        });
        if (recentCount >= args.maxPerHour) {
          return { status: 'cap_reached' as const };
        }
        const created = await tx.adImpression.create({
          data: {
            campaignId: args.campaignId,
            creativeId: args.creativeId,
            userId: args.userId,
            deviceId: args.deviceId,
            sessionId: args.sessionId,
            impressionTokenHash: args.impressionTokenHash,
            waitStateId: args.waitStateId,
            idempotencyKey: args.idempotencyKey,
          },
          select: { id: true },
        });
        return { status: 'claimed' as const, impressionId: created.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 },
    );
  }

  // ── Ad Event Tracking ──
  async recordRendered(
    userId: string,
    dto: {
      impressionToken: string;
      renderedAt: string;
      visibleSurface?: number;
      idempotencyKey: string;
      signature: string;
    },
  ) {
    this.enforcePrivacyOn(dto);
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
    if (!(await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature))) {
      throw new ForbiddenException('Invalid request signature');
    }
    if (impression.renderedAt) return impression; // Already recorded
    return this.prisma.adImpression.update({
      where: { id: impression.id },
      data: {
        // The render timestamp is recorded by the SERVER, not trusted from the
        // client. A client could otherwise backdate `renderedAt` and bypass the
        // minimum-visible-duration check at qualification time (issue A-060).
        // The HMAC signature is still verified against the client payload
        // (which includes its own `renderedAt`), so possession of the device
        // secret is proven; only the stored, billing-relevant time is server
        // authoritative.
        renderedAt: new Date(),
        visibleSurface: dto.visibleSurface,
      },
    });
  }

  async recordQualifiedImpression(
    userId: string,
    dto: {
      impressionToken: string;
      qualifiedAt: string;
      visibleDurationMs: number;
      idempotencyKey: string;
      signature: string;
    },
  ) {
    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
      include: {
        campaign: {
          select: {
            id: true,
            bidAmountMinor: true,
            currency: true,
            advertiserId: true,
            bidType: true,
          },
        },
        user: {
          select: { status: true },
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
    if (!(await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature))) {
      throw new ForbiddenException('Invalid request signature');
    }
    if (!isActiveAccountStatus(impression.user.status)) {
      await this.prisma.adImpression.update({
        where: { id: impression.id },
        data: {
          qualifiedAt: new Date(dto.qualifiedAt),
          visibleDurationMs: dto.visibleDurationMs,
          isBillable: false,
          invalidationReason: 'account_not_active',
        },
      });
      return { qualified: false, impressionId: impression.id, reason: 'account_not_active' };
    }
    // Minimum visible duration is a SERVER-SIDE timing invariant (issue A-060).
    // The render timestamp is recorded by the server in `recordRendered()`, so
    // a client cannot fast-forward or backdate it. A billable impression may
    // only qualify once the server has actually observed at least
    // MINIMUM_VISIBLE_DURATION_MS elapse since render — a small grace window
    // absorbs clock skew and processing variance, but an immediate
    // render→qualify (or a future-dated render) is rejected. The claimed
    // `visibleDurationMs` is still clamped so it can never exceed real elapsed
    // wall-clock time.
    const MIN_DURATION_GRACE_MS = 1500;
    if (!impression.renderedAt) {
      return {
        qualified: false,
        reason: 'render_required',
        minimumRequired: MINIMUM_VISIBLE_DURATION_MS,
        actual: 0,
      };
    }
    const elapsedServer = Date.now() - impression.renderedAt.getTime();
    if (elapsedServer < MINIMUM_VISIBLE_DURATION_MS - MIN_DURATION_GRACE_MS) {
      return {
        qualified: false,
        reason: 'minimum_duration_not_met',
        minimumRequired: MINIMUM_VISIBLE_DURATION_MS,
        actual: Math.max(0, elapsedServer),
      };
    }
    let effectiveDurationMs = dto.visibleDurationMs;
    if (dto.visibleDurationMs > elapsedServer + 5000) {
      effectiveDurationMs = elapsedServer;
    }
    if (effectiveDurationMs < MINIMUM_VISIBLE_DURATION_MS) {
      return {
        qualified: false,
        reason: 'minimum_duration_not_met',
        minimumRequired: MINIMUM_VISIBLE_DURATION_MS,
        actual: effectiveDurationMs,
      };
    }
    if (impression.qualifiedAt)
      return { qualified: true, impressionId: impression.id, alreadyQualified: true };
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
      return {
        qualified: false,
        impressionId: impression.id,
        reason: rateCheck.reason || 'fraud_detected',
      };
    }
    if (impression.campaign.bidType === 'cpc') {
      const claim = await this.prisma.adImpression.updateMany({
        where: { id: impression.id, qualifiedAt: null },
        data: {
          qualifiedAt: new Date(dto.qualifiedAt),
          visibleDurationMs: dto.visibleDurationMs,
          isBillable: true,
        },
      });
      if (claim.count === 0) {
        return { qualified: true, impressionId: impression.id, alreadyQualified: true };
      }
      return { qualified: true, impressionId: impression.id };
    }
    // Look up the user's trust level for hold days
    const trustScore = await this.prisma.trustScore.findUnique({
      where: { userId: impression.userId },
    });
    const trustLevel = trustScore?.level || 'new';
    const split = this.ledger.calculateSplit(BigInt(impression.campaign.bidAmountMinor));
    const holdDays = this.ledger.getHoldDays(trustLevel);
    // RESTRICTED → holdDays = -1 (indefinite). A negative hold must never
    // produce an `availableAt` in the past (that would immediately mature the
    // earnings and make them payout-eligible, the opposite of the restricted
    // policy). Store null → never matures via matureEarnings (SQL NULL <= date
    // is false). Mirrors the guard in ledger.service.ts.
    const availableAt = holdDays < 0 ? null : new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `imp-${impression.id}`;
    // Single atomic transaction: impression update + all ledger entries + campaign spend.
    // The CAS claim happens FIRST. If a concurrent request already qualified it,
    // we return early without touching campaign budget or ledger tables.
    // The spend guard uses raw SQL UPDATE…WHERE so two concurrent CPM impressions
    // cannot both pass the JS pre-flight check and exceed budgetTotalMinor.
    // If the budget increment fails, we throw a BudgetExhaustedError to rollback.
    let billed: 'already_qualified' | 'billed';
    try {
      billed = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // (0) Account-level billing serialization (issue A-055): serialize all
        // billing writes for this advertiser+currency so concurrent CPM/CPC
        // events on different campaigns cannot both read the same pre-bill
        // balance and overdraw the advertiser's account.
        const balanceLockKey = advertiserCurrencyLockKey(
          impression.campaign.advertiserId,
          impression.campaign.currency,
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${balanceLockKey})`;
        // (1) Atomic CAS: only flip this impression to billable if it has NOT
        // been qualified concurrently. Two concurrent recordQualifiedImpression
        // calls for the same impression both pass the outer
        // `if (impression.qualifiedAt) return` check (neither has written yet).
        // The conditional UPDATE ensures at most one caller wins the flip;
        // the loser (claim.count === 0) returns early without writing
        // any ledger rows or incrementing campaign budget.
        const claim = await tx.adImpression.updateMany({
          where: { id: impression.id, qualifiedAt: null },
          data: {
            qualifiedAt: new Date(dto.qualifiedAt),
            visibleDurationMs: dto.visibleDurationMs,
            isBillable: true,
          },
        });
        if (claim.count === 0) {
          return 'already_qualified';
        }
        // (1.5) Account-level balance guard (issue A-055): re-check the
        // spendable balance INSIDE the locked transaction. The centralized
        // formula subtracts confirmed refunds, so a confirmed archive refund
        // also blocks further spend.
        const advertiserBalance = await getAdvertiserBalance(
          tx as unknown as PrismaService,
          impression.campaign.advertiserId,
          impression.campaign.currency,
        );
        if (advertiserBalance < impression.campaign.bidAmountMinor) {
          throw new AdvertiserBalanceExhaustedError();
        }
        // (2) Atomic spend increment — rejects when budget would overflow OR the
        // campaign is no longer `active`.
        const spent: number = await tx.$executeRawUnsafe(
          `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1::bigint WHERE "id" = $2 AND "budgetSpentMinor" + $1::bigint <= "budgetTotalMinor" AND "status" = 'active'`,
          impression.campaign.bidAmountMinor,
          impression.campaignId,
        );
        if (spent === 0) {
          throw new BudgetExhaustedError();
        }
        // (3) Debit advertiser balance
        await tx.advertiserLedger.create({
          data: {
            advertiserId: impression.campaign.advertiserId,
            campaignId: impression.campaignId,
            entryType: 'debit',
            status: 'confirmed',
            amountMinor: BigInt(impression.campaign.bidAmountMinor),
            currency: impression.campaign.currency,
            idempotencyKey: `${idempotencyBase}-adv`,
            description: `Impression ${impression.id} - campaign ${impression.campaignId}`,
          },
        });
        // (4) Credit developer (estimated until hold expires)
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
        // (5) Credit platform fee
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
        // (6) Credit fraud/payment reserve
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
        return 'billed';
      });
    } catch (err) {
      if (err instanceof BudgetExhaustedError) {
        await this.prisma.adImpression.update({
          where: { id: impression.id },
          data: {
            qualifiedAt: new Date(dto.qualifiedAt),
            visibleDurationMs: dto.visibleDurationMs,
            isBillable: false,
            invalidationReason: 'budget_exhausted',
          },
        });
        return { qualified: false, impressionId: impression.id, reason: 'budget_exhausted' };
      }
      if (err instanceof AdvertiserBalanceExhaustedError) {
        await this.prisma.adImpression.update({
          where: { id: impression.id },
          data: {
            qualifiedAt: new Date(dto.qualifiedAt),
            visibleDurationMs: dto.visibleDurationMs,
            isBillable: false,
            invalidationReason: 'insufficient_advertiser_balance',
          },
        });
        return {
          qualified: false,
          impressionId: impression.id,
          reason: 'insufficient_advertiser_balance',
        };
      }
      throw err;
    }
    if (billed === 'already_qualified') {
      return { qualified: true, impressionId: impression.id, alreadyQualified: true };
    }
    return { qualified: true, impressionId: impression.id };
  }

  async recordClick(
    userId: string,
    dto: {
      impressionToken: string;
      clickedAt: string;
      idempotencyKey: string;
      signature: string;
    },
  ) {
    this.enforcePrivacyOn(dto);
    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
      include: {
        campaign: {
          select: {
            id: true,
            bidAmountMinor: true,
            currency: true,
            advertiserId: true,
            bidType: true,
          },
        },
        user: {
          select: { status: true },
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
    if (!(await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature))) {
      throw new ForbiddenException('Invalid request signature');
    }
    if (!isActiveAccountStatus(impression.user.status)) {
      return { clicked: false, reason: 'account_not_active' };
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
    const trustScore = await this.prisma.trustScore.findUnique({
      where: { userId: impression.userId },
    });
    const trustLevel = trustScore?.level || 'new';
    const creative = await this.prisma.adCreative.findUnique({
      where: { id: impression.creativeId },
      select: { destinationUrl: true },
    });
    if (!creative) throw new NotFoundException('Creative not found');
    const holdDays = this.ledger.getHoldDays(trustLevel);
    // RESTRICTED → holdDays = -1 (indefinite). Never compute a past
    // `availableAt` for restricted users; null ⇒ never matures. See ledger.service.ts.
    const availableAt = holdDays < 0 ? null : new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const split = isCpcBid
      ? this.ledger.calculateSplit(BigInt(impression.campaign.bidAmountMinor))
      : null;
    let click: {
      id: string;
    };
    try {
      click = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // (0) Account-level billing serialization (issue A-055): serialize all
        // billing writes for this advertiser+currency so concurrent CPM/CPC
        // events on different campaigns cannot both read the same pre-bill
        // balance and overdraw the advertiser's account.
        const balanceLockKey = advertiserCurrencyLockKey(
          impression.campaign.advertiserId,
          impression.campaign.currency,
        );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${balanceLockKey})`;
        // (0.5) Account-level balance guard (issue A-055): re-check the
        // spendable balance INSIDE the locked transaction before billing.
        if (isCpcBid) {
          const advertiserBalance = await getAdvertiserBalance(
            tx as unknown as PrismaService,
            impression.campaign.advertiserId,
            impression.campaign.currency,
          );
          if (advertiserBalance < BigInt(impression.campaign.bidAmountMinor)) {
            throw new AdvertiserBalanceExhaustedError();
          }
        }
        const click = await tx.adClick.create({
          data: {
            impressionId: impression.id,
            userId: impression.userId,
            deviceId: impression.deviceId,
            sessionId: impression.sessionId,
            campaignId: impression.campaignId,
            creativeId: impression.creativeId,
            clickedAt: new Date(dto.clickedAt),
            targetUrl: creative.destinationUrl,
            idempotencyKey: dto.idempotencyKey,
          },
        });
        if (isCpcBid && split) {
          // Atomic budget guard for CPC clicks — same pattern as CPM above,
          // including the `status = 'active'` TOCTOU guard against
          // concurrent archive/pause.
          const spent: number = await tx.$executeRawUnsafe(
            `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1::bigint WHERE "id" = $2 AND "budgetSpentMinor" + $1::bigint <= "budgetTotalMinor" AND "status" = 'active'`,
            impression.campaign.bidAmountMinor,
            impression.campaignId,
          );
          if (spent === 0) {
            throw new ConflictException('Campaign budget exhausted or no longer active');
          }
          const idempotencyBase = `clk-${click.id}`;
          await tx.advertiserLedger.create({
            data: {
              advertiserId: impression.campaign.advertiserId,
              campaignId: impression.campaignId,
              entryType: 'debit',
              status: 'confirmed',
              amountMinor: BigInt(impression.campaign.bidAmountMinor),
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
      if (error instanceof AdvertiserBalanceExhaustedError) {
        return {
          clicked: false,
          impressionId: impression.id,
          reason: 'insufficient_advertiser_balance',
        };
      }
      if (isUniqueConstraintViolation(error)) {
        return { clicked: false, reason: 'duplicate_click' };
      }
      throw error;
    }
    return { clicked: true, clickId: click.id };
  }
}
export interface ExtensionAdTrait extends ExtensionDeviceReportTrait {}
