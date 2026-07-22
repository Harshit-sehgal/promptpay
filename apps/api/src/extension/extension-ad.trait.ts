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
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { isUniqueConstraintViolation } from '../common/utils/errors';
import { ComplianceService } from '../compliance/compliance.service';
import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { MetricsService } from '../observability/metrics.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { AuctionService } from './auction.service';
import { normalizeCountryCode } from './country-targeting';
import {
  adCacheKey,
  adIdempotencyCacheKey,
  AdvertiserBalanceExhaustedError,
  advertiserCurrencyLockKey,
  BudgetExhaustedError,
  classifyWaitState,
  DetectorEvidence,
  isVerifiedDetectorSource,
  mergeBlockedCategories,
  ServedAd,
  WaitSignal,
} from './extension.constants';
import { ExtensionDeviceReportTrait } from './extension-device-report.trait';
import { MINIMUM_WAIT_CONFIDENCE } from './extension-wait.trait';
import { formatHHMMInZone, isTimeInRange } from './quiet-hours';

/**
 * Run a best-effort, non-blocking async task without letting a missing method
 * or a rejected promise escape into the ad-serving critical path. These signals
 * are advisory (they create flags for review); a transient failure or an
 * incompletely-mocked collaborator must never prevent serving an ad or
 * recording an impression. Errors are logged and surfaced to metrics so a
 * failing fraud check is observable rather than silently swallowed.
 */
function nonBlocking(
  task: Promise<unknown> | undefined,
  logger: Logger,
  metrics: MetricsService,
  label: string,
): void {
  if (!task) return;
  void task.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ label, error: message }, 'Non-blocking fraud signal failed');
    metrics.increment(`fraud_signal_error{label=${label}}`);
  });
}

export class ExtensionAdTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare ledger: LedgerService;
  declare fraud: FraudService;
  declare compliance: ComplianceService;
  declare runtimeConfig: RuntimeConfigService;
  declare metrics: MetricsService;
  declare adCache: LRUCache<string, { ad: ServedAd }>;
  private auctionService?: AuctionService;
  declare logger: Logger;

  private async requireAdTelemetryConsent(userId: string): Promise<void> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { waitTelemetryEnabled: true },
    });
    if (!settings?.waitTelemetryEnabled) {
      throw new ForbiddenException('wait_telemetry_consent_required');
    }
  }

  /** A provider/server-signed assertion is the money trust boundary. Device
   * HMACs and detector evidence can guide ad relevance but cannot settle an
   * earning without this durable, replay-protected binding. */
  private async hasVerifiedWaitAttestation(impression: {
    userId: string;
    deviceId: string;
    waitStateId: string | null;
    attestationSessionId?: string | null;
  }): Promise<boolean> {
    if (!impression.waitStateId || !impression.attestationSessionId) return false;
    return Boolean(
      await this.prisma.waitAttestation.findFirst({
        where: {
          sessionId: impression.attestationSessionId,
          userId: impression.userId,
          deviceId: impression.deviceId,
          waitStateId: impression.waitStateId,
        },
        select: { id: true },
      }),
    );
  }

  /** Re-read mutable safety state just before a financial authorization. */
  private async financialAuthorization(impression: {
    userId: string;
    deviceId: string;
    sessionId: string;
    waitStateId: string | null;
    attestationSessionId?: string | null;
  }): Promise<{ allowed: true } | { allowed: false; reason: string }> {
    if (!(await this.runtimeConfig.isWaitEarningsEnabled())) {
      return { allowed: false, reason: 'wait_earnings_disabled' };
    }
    const [user, waitStart, attestation] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: impression.userId }, select: { status: true } }),
      this.prisma.waitStateEvent.findFirst({
        where: {
          userId: impression.userId,
          deviceId: impression.deviceId,
          sessionId: impression.sessionId,
          waitStateId: impression.waitStateId ?? '',
          eventType: 'wait_state_start',
        },
        select: { isFalsePositive: true, detectorVersion: true },
      }),
      impression.attestationSessionId
        ? this.prisma.waitAttestation.findFirst({
            where: {
              sessionId: impression.attestationSessionId,
              userId: impression.userId,
              deviceId: impression.deviceId,
              waitStateId: impression.waitStateId ?? '',
            },
            select: { id: true },
          })
        : null,
    ]);
    if (!waitStart) return { allowed: false, reason: 'wait_state_missing' };
    if (waitStart.isFalsePositive) return { allowed: false, reason: 'user_reported_false_positive' };
    if (!user || !isActiveAccountStatus(user.status)) {
      return { allowed: false, reason: 'account_not_active' };
    }
    if (!attestation) return { allowed: false, reason: 'unverified_wait_attestation' };
    if (!(await this.runtimeConfig.isDetectorVersionEnabled(waitStart.detectorVersion))) {
      return { allowed: false, reason: 'detector_version_disabled' };
    }
    return { allowed: true };
  }

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
    await this.requireAdTelemetryConsent(userId);
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
    // Launch-integrity gate: do not show a monetization surface when the
    // server cannot settle rewards. A client-held device secret is not an
    // independent proof of a productive wait, so the default launch mode is
    // deliberately telemetry_only until an operator enables a reviewed attestation
    // path. Returning the explicit mode lets shipped clients explain the
    // state honestly instead of displaying an ad that will later be voided.
    const launchMode = await this.runtimeConfig.getWaitLaunchMode();
    if (launchMode !== 'earnings_enabled') {
      return {
        ad: null,
        reason: launchMode === 'paused' ? 'platform_ads_paused' : 'earnings_not_available',
        mode: launchMode,
      };
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
    // P1.17: detector-version kill-switch. Refuse to serve ads for a disabled
    // detector version so a bad release cannot accrue billable impressions,
    // even if a wait state was recorded before the kill-switch took effect.
    if (!(await this.runtimeConfig.isDetectorVersionEnabled(waitStart.detectorVersion))) {
      return { ad: null, reason: 'detector_version_disabled' };
    }
    // Do not bill inactivity-only events. Wait states must have sufficient
    // confidence (from AI tools, active tasks, commands, lifecycle events)
    // and not be flagged as a false positive by the user.
    if (
      waitStart.confidence === null ||
      waitStart.confidence < MINIMUM_WAIT_CONFIDENCE ||
      waitStart.isFalsePositive
    ) {
      return { ad: null, reason: 'low_confidence_wait' };
    }

    // Serving is itself a reward-bearing commitment: require a still
    // unconsumed attestation attempt that was issued before this wait began.
    // Consumption intentionally happens after the operation; its durable
    // result is rechecked again immediately before ledger writes.
    const attestationSession = await this.prisma.waitAttestationSession.findFirst({
      where: {
        userId,
        deviceId: dto.deviceId,
        clientSessionId: dto.sessionId,
        waitStateId: dto.waitStateId,
        consumedAt: null,
        operationStartDeadline: { gte: waitStart.createdAt },
        consumeDeadline: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!attestationSession) {
      return { ad: null, reason: 'wait_attestation_session_required' };
    }

    // P1 durable idempotency: before serving a new ad, look for an prior
    // response keyed by idempotencyKey or waitStateId. This runs after the
    // wait-state gate so a replay still must be valid, but before the auction
    // so we do not reserve budget twice.
    const durable = await this.lookupDurableAdResponse(userId, dto);
    if (durable) {
      if (durable.status === 'conflict') {
        throw new ConflictException(durable.reason);
      }
      this.adCache.set(adIdempotencyCacheKey(userId, dto.deviceId, dto.idempotencyKey), {
        ad: durable.ad,
      });
      this.adCache.set(adCacheKey(userId, dto.deviceId, dto.waitStateId), { ad: durable.ad });
      return { ad: durable.ad };
    }
    // P0.1: Re-classify the stored wait state at request time using the
    // current detector allowlist. A single forged `ai_generation` signal may
    // still pass the ad-confidence gate above, but it must not reach payment
    // without corroboration. We recompute here so policy changes (e.g. an
    // updated allowlist) apply retroactively to existing wait-state rows.
    const signals = ((waitStart.signals as unknown as WaitSignal[] | null) ?? []).filter(
      (s): s is WaitSignal => s && typeof s === 'object' && 'type' in s,
    );
    const evidence = ((waitStart.evidence as unknown as DetectorEvidence[] | null) ?? []).filter(
      (e): e is DetectorEvidence => e && typeof e === 'object' && 'type' in e,
    );
    const detectorAllowlist = this.runtimeConfig.getVerifiedDetectorVersions();
    const classification = classifyWaitState(
      signals,
      isVerifiedDetectorSource(waitStart.detectorVersion, detectorAllowlist),
      evidence,
    );
    if (!classification.adEligible) {
      return { ad: null, reason: 'low_confidence_wait' };
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
    // Global platform kill-switch for advertising
    if (!(await this.runtimeConfig.isAdsEnabled())) {
      return { ad: null, reason: 'platform_ads_paused' };
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
    // Runtime kill-switch: blocked countries
    if (!(await this.runtimeConfig.isCountryAllowed(userCountry))) {
      return { ad: null, reason: 'country_blocked' };
    }
    // Non-blocking fraud signal: country-device mismatch detection
    nonBlocking(
      this.fraud.checkCountryDeviceChange?.(userId, dto.deviceId, userCountry ?? null),
      this.logger,
      this.metrics,
      'checkCountryDeviceChange',
    );
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
    // Auction selection is delegated to AuctionService (P2.1 extraction). It
    // replicates the previous inline logic exactly: fetch active campaigns with
    // approved creatives, filter by budget/category/country/frequency/balance,
    // run the currency-safe weighted auction, and retry on reservation loss.
    const auctionService =
      this.auctionService ?? (this.auctionService = new AuctionService(this.prisma, this.audit));
    const maxPerHour = settings?.maxAdsPerHour ?? 6;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const eligible = await auctionService.selectEligibleCampaign({
      userId,
      effectiveBlocked,
      allowedCategories: dto.allowedCategories,
      userCountry,
      oneHourAgo,
      oneDayAgo,
    });
    if (!eligible.length) {
      return { ad: null, reason: 'no_eligible_campaign' };
    }
    return auctionService.runAuction({
      eligible,
      userId,
      deviceId: dto.deviceId,
      sessionId: dto.sessionId,
      waitStateId: dto.waitStateId,
      attestationSessionId: attestationSession.id,
      idempotencyKey: dto.idempotencyKey,
      maxPerHour,
      oneHourAgo,
      adCache: this.adCache,
      claimImpression: (args) => this.claimImpression(args),
    });
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
  /**
   * Durable distributed idempotency lookup for ad responses.
   *
   * If an impression exists for this idempotency key or wait state and the
   * stored request fields match the current request, reconstruct and return the
   * original `ServedAd` (including the raw impression token). If the same key
   * was used with a different request, return a conflict marker so the caller
   * can throw 409. Returns `null` when no prior response exists.
   */
  private async lookupDurableAdResponse(
    userId: string,
    dto: {
      deviceId: string;
      sessionId: string;
      waitStateId: string;
      idempotencyKey: string;
    },
  ): Promise<{ status: 'ad'; ad: ServedAd } | { status: 'conflict'; reason: string } | null> {
    const existing = await this.prisma.adImpression.findFirst({
      where: {
        userId,
        OR: [{ idempotencyKey: dto.idempotencyKey }, { waitStateId: dto.waitStateId }],
      },
      include: {
        campaign: { select: { id: true } },
        creative: {
          select: {
            id: true,
            title: true,
            sponsoredMessage: true,
            displayDomain: true,
            destinationUrl: true,
            ctaText: true,
          },
        },
      },
    });
    if (!existing) return null;

    const sameIdempotencyKey = existing.idempotencyKey === dto.idempotencyKey;
    const sameWaitState = existing.waitStateId === dto.waitStateId;

    if (sameIdempotencyKey) {
      if (
        existing.deviceId !== dto.deviceId ||
        existing.sessionId !== dto.sessionId ||
        existing.waitStateId !== dto.waitStateId
      ) {
        return {
          status: 'conflict',
          reason: 'Idempotency key already used with different request',
        };
      }
    }

    if (sameWaitState && existing.idempotencyKey !== dto.idempotencyKey) {
      return {
        status: 'conflict',
        reason: 'Wait state already served with a different idempotency key',
      };
    }

    if (!existing.impressionToken || !existing.creative) {
      // Legacy rows without the stored token cannot be reconstructed.
      return null;
    }

    const ad: ServedAd = {
      impressionToken: existing.impressionToken,
      campaignId: existing.campaignId,
      creativeId: existing.creativeId,
      title: existing.creative.title,
      message: existing.creative.sponsoredMessage,
      label: 'Sponsored',
      displayDomain: existing.creative.displayDomain ?? '',
      destinationUrl: existing.creative.destinationUrl,
      ctaText: existing.creative.ctaText ?? null,
    };
    return { status: 'ad', ad };
  }

  async recentBillableCampaignIds(userId: string, oneHourAgo: Date): Promise<string[]> {
    const recent = await this.prisma.adImpression.findMany({
      where: { userId, isBillable: true, createdAt: { gte: oneHourAgo } },
      select: { campaignId: true },
    });
    return [...new Set(recent.map((i: { campaignId: string }) => i.campaignId))];
  }

  /**
   * Atomically: reject duplicate idempotency/waitState, enforce the hourly cap,
   * reserve CPM budget, and persist the new impression. Runs under a
   * serializable transaction + per-user advisory lock so concurrent ad-requests
   * serialize per user. The reservation and impression insert commit or roll
   * back together, so a process failure cannot leave an orphan reservation.
   *
   * Returns one of:
   *   - { status: 'claimed', impressionId }              (impression created)
   *   - { status: 'duplicate' }                          (idempotency/waitState already claimed)
   *   - { status: 'cap_reached' }                        (user_hourly_cap_reached)
   *   - { status: 'budget_unavailable' }                 (campaign no longer reservable)
   */
  async claimImpression(args: {
    userId: string;
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    attestationSessionId: string;
    idempotencyKey: string;
    campaignId: string;
    creativeId: string;
    impressionToken: string;
    impressionTokenHash: string;
    bidType: BidType;
    bidAmountMinor: bigint;
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
    | {
        status: 'budget_unavailable';
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
        // Reserve CPM budget only after the duplicate and exposure-cap checks.
        // Keeping this guarded UPDATE in the same transaction as the INSERT is
        // essential: any insert error or process/transaction failure rolls the
        // reservation back instead of orphaning aggregate reserved budget.
        if (args.bidType === BidType.cpm) {
          const reserved: number = await tx.$executeRaw`
            UPDATE "campaigns"
            SET "budget_reserved_minor" = "budget_reserved_minor" + ${args.bidAmountMinor}
            WHERE "id" = ${args.campaignId}
              AND "status" = 'active'
              AND "budgetSpentMinor" + "budget_reserved_minor" + ${args.bidAmountMinor} <= "budgetTotalMinor"
          `;
          if (reserved === 0) {
            return { status: 'budget_unavailable' as const };
          }
        }
        const created = await tx.adImpression.create({
          data: {
            campaignId: args.campaignId,
            creativeId: args.creativeId,
            userId: args.userId,
            deviceId: args.deviceId,
            sessionId: args.sessionId,
            impressionToken: args.impressionToken,
            impressionTokenHash: args.impressionTokenHash,
            waitStateId: args.waitStateId,
            attestationSessionId: args.attestationSessionId,
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
  /**
   * Atomically claim a terminal non-billable outcome and release exactly that
   * impression's CPM reservation. The impression CAS runs first, so concurrent
   * qualification/invalidation attempts cannot decrement the campaign's
   * aggregate reservation on behalf of a different impression.
   */
  async invalidateImpressionAndReleaseReservation(args: {
    impressionId: string;
    campaignId: string;
    bidType: BidType;
    bidAmountMinor: bigint;
    visibleDurationMs: number;
    reason: string;
  }): Promise<'invalidated' | 'already_processed'> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const now = new Date();
      const claim = await tx.adImpression.updateMany({
        where: {
          id: args.impressionId,
          qualifiedAt: null,
          invalidatedAt: null,
        },
        data: {
          qualifiedAt: now,
          invalidatedAt: now,
          visibleDurationMs: args.visibleDurationMs,
          isBillable: false,
          invalidationReason: args.reason,
        },
      });
      if (claim.count === 0) {
        return 'already_processed';
      }

      if (args.bidType === BidType.cpm && args.bidAmountMinor > 0n) {
        await tx.$executeRaw`
          UPDATE "campaigns"
          SET "budget_reserved_minor" = "budget_reserved_minor" - ${args.bidAmountMinor}
          WHERE "id" = ${args.campaignId}
            AND "budget_reserved_minor" >= ${args.bidAmountMinor}
        `;
      }
      return 'invalidated';
    });
  }

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
      await this.invalidateImpressionAndReleaseReservation({
        impressionId: impression.id,
        campaignId: impression.campaignId,
        bidType: impression.campaign.bidType,
        bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
        visibleDurationMs: dto.visibleDurationMs,
        reason: 'account_not_active',
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
    // P0.1: client-held device HMACs and detector telemetry are useful fraud
    // signals, but they are not independent proof that a real tool wait took
    // place. Do not settle CPM/CPC money until an operator has deliberately
    // enabled the separately reviewed attestation path. For CPM this also
    // releases the exact reservation made when the ad was served; CPC has no
    // reservation, but invalidating here prevents a later click from billing.
    if (!(await this.runtimeConfig.isWaitEarningsEnabled())) {
      await this.invalidateImpressionAndReleaseReservation({
        impressionId: impression.id,
        campaignId: impression.campaignId,
        bidType: impression.campaign.bidType,
        bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
        visibleDurationMs: effectiveDurationMs,
        reason: 'wait_earnings_disabled',
      });
      return { qualified: false, impressionId: impression.id, reason: 'wait_earnings_disabled' };
    }
    if (impression.qualifiedAt)
      return { qualified: true, impressionId: impression.id, alreadyQualified: true };
    // Fraud check via rate limits
    const rateCheck = await this.fraud.checkImpressionRateLimit(
      impression.userId,
      impression.deviceId,
    );
    // Non-blocking extended fraud signals: these create flags for review but
    // do not block the current impression (the rate-limit gate above is the
    // blocking check). Fire-and-forget so the ad-serving critical path is not
    // slowed by multi-query pattern analysis.
    nonBlocking(
      this.fraud.checkImpossibleVolume?.(impression.userId),
      this.logger,
      this.metrics,
      'checkImpossibleVolume',
    );
    nonBlocking(
      this.fraud.checkAutomatedPattern?.(impression.userId),
      this.logger,
      this.metrics,
      'checkAutomatedPattern',
    );
    nonBlocking(
      this.fraud.checkRapidEarningSpike?.(impression.userId),
      this.logger,
      this.metrics,
      'checkRapidEarningSpike',
    );
    const isBillable = rateCheck.allowed;
    if (!isBillable) {
      const reason = rateCheck.reason || 'fraud_detected';
      await this.invalidateImpressionAndReleaseReservation({
        impressionId: impression.id,
        campaignId: impression.campaignId,
        bidType: impression.campaign.bidType,
        bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
        visibleDurationMs: effectiveDurationMs,
        reason,
      });
      return {
        qualified: false,
        impressionId: impression.id,
        reason,
      };
    }
    const financialGate = await this.financialAuthorization(impression);
    if (!financialGate.allowed) {
      await this.invalidateImpressionAndReleaseReservation({
        impressionId: impression.id,
        campaignId: impression.campaignId,
        bidType: impression.campaign.bidType,
        bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
        visibleDurationMs: effectiveDurationMs,
        reason: financialGate.reason,
      });
      return { qualified: false, impressionId: impression.id, reason: financialGate.reason };
    }
    if (impression.campaign.bidType === 'cpc') {
      const claim = await this.prisma.adImpression.updateMany({
        where: { id: impression.id, qualifiedAt: null },
        data: {
          qualifiedAt: new Date(),
          visibleDurationMs: effectiveDurationMs,
          isQualified: true,
          // A CPC render is only qualified. `isBillable` becomes true in the
          // click transaction, at the same time as the ledger entries.
          isBillable: false,
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
    // P0.1: Re-classify the original wait state to enforce the payment gate
    // and apply longer holds for unverified detector sources.
    const waitStartForImpression = await this.prisma.waitStateEvent.findFirst({
      where: {
        userId: impression.userId,
        deviceId: impression.deviceId,
        sessionId: impression.sessionId,
        waitStateId: impression.waitStateId ?? '',
        eventType: 'wait_state_start',
      },
      orderBy: { createdAt: 'desc' },
    });
    const waitSignals = (
      (waitStartForImpression?.signals as unknown as WaitSignal[] | null) ?? []
    ).filter((s): s is WaitSignal => s && typeof s === 'object' && 'type' in s);
    const waitEvidence = (
      (waitStartForImpression?.evidence as unknown as DetectorEvidence[] | null) ?? []
    ).filter((e): e is DetectorEvidence => e && typeof e === 'object' && 'type' in e);
    const detectorAllowlist = this.runtimeConfig.getVerifiedDetectorVersions();
    const classification = classifyWaitState(
      waitSignals,
      isVerifiedDetectorSource(waitStartForImpression?.detectorVersion, detectorAllowlist),
      waitEvidence,
    );
    // The signed provider assertion is mandatory for settlement. Client HMAC
    // evidence alone must never become withdrawable money, even when it uses
    // an allowlisted adapter/version pair.
    if (
      waitStartForImpression?.isFalsePositive ||
      !classification.adEligible ||
      !(await this.hasVerifiedWaitAttestation(impression))
    ) {
      await this.invalidateImpressionAndReleaseReservation({
        impressionId: impression.id,
        campaignId: impression.campaignId,
        bidType: impression.campaign.bidType,
        bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
        visibleDurationMs: effectiveDurationMs,
        reason: 'unverified_wait_attestation',
      });
      return {
        qualified: false,
        impressionId: impression.id,
        reason: 'unverified_wait_attestation',
      };
    }
    const split = this.ledger.calculateSplit(BigInt(impression.campaign.bidAmountMinor));
    const holdDays = this.ledger.getHoldDays(trustLevel, false);
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
          where: { id: impression.id, qualifiedAt: null, invalidatedAt: null },
          data: {
          qualifiedAt: new Date(),
          visibleDurationMs: effectiveDurationMs,
          isQualified: true,
          billingAuthorizedAt: new Date(),
          isBillable: true,
          billedAt: new Date(),
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
        // (2) Convert the reserved budget to spent budget. The reservation was
        // made at requestAd time; here we atomically decrement reserved and
        // increment spent. Paused campaigns may settle impressions served
        // before the pause, but archive is terminal: archiveCampaign releases
        // all outstanding reservations before recording its refund obligation.
        const spent: number = await tx.$executeRaw`
          UPDATE "campaigns"
          SET "budgetSpentMinor" = "budgetSpentMinor" + ${BigInt(impression.campaign.bidAmountMinor)},
              "budget_reserved_minor" = "budget_reserved_minor" - ${BigInt(impression.campaign.bidAmountMinor)}
          WHERE "id" = ${impression.campaignId}
            AND "budget_reserved_minor" >= ${BigInt(impression.campaign.bidAmountMinor)}
            AND "status" <> 'archived'
        `;
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
        await this.invalidateImpressionAndReleaseReservation({
          impressionId: impression.id,
          campaignId: impression.campaignId,
          bidType: impression.campaign.bidType,
          bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
          visibleDurationMs: effectiveDurationMs,
          reason: 'budget_exhausted',
        });
        return { qualified: false, impressionId: impression.id, reason: 'budget_exhausted' };
      }
      if (err instanceof AdvertiserBalanceExhaustedError) {
        await this.invalidateImpressionAndReleaseReservation({
          impressionId: impression.id,
          campaignId: impression.campaignId,
          bidType: impression.campaign.bidType,
          bidAmountMinor: BigInt(impression.campaign.bidAmountMinor),
          visibleDurationMs: effectiveDurationMs,
          reason: 'insufficient_advertiser_balance',
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
    // The same fail-closed settlement gate used by CPM qualification must also
    // cover already-qualified CPC impressions. Otherwise an operator disabling
    // the gate could still incur a fresh advertiser debit from a click on a
    // legacy impression that qualified before the switch changed.
    if (
      impression.campaign.bidType === BidType.cpc &&
      !(await this.runtimeConfig.isWaitEarningsEnabled())
    ) {
      return { clicked: false, impressionId: impression.id, reason: 'wait_earnings_disabled' };
    }
    if (impression.campaign.bidType === BidType.cpc) {
      const financialGate = await this.financialAuthorization(impression);
      if (!financialGate.allowed) {
        return { clicked: false, impressionId: impression.id, reason: financialGate.reason };
      }
    }
    // Fraud checks: rate + self-click
    const clickPatterns = await this.fraud.checkClickPatterns(impression.userId, impression.id);
    if (!clickPatterns.allowed) {
      return { clicked: false, reason: clickPatterns.reason || 'click_blocked' };
    }
    const selfClick = await this.fraud.checkSelfClick(impression.userId, impression.campaignId);
    if (!selfClick.allowed) {
      return { clicked: false, reason: selfClick.reason || 'self_click' };
    }
    // Non-blocking extended click-abuse signal
    void this.fraud
      .checkRepeatedClickAbuse(impression.userId, impression.campaignId)
      .catch(() => undefined);
    // removed redundant existingClick findFirst (non-locked read).
    // @unique(impressionId) on AdClick + P2002 catch below are the real floor
    // — the findFirst misled readers into thinking JS was load-bearing when
    // the DB unique constraint already guarantees exactly one click per
    // impression. Concurrent recordClick calls race past the findFirst, both
    // attempt create, and the P2002 loser returns duplicate_click. The
    // outcome is identical without this redundant read.
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
    // P0.1: Re-classify the original wait state for click billing so
    // unverified detector sources get the extended hold and a single forged
    // signal cannot earn via CPC either.
    const waitStartForClick = await this.prisma.waitStateEvent.findFirst({
      where: {
        userId: impression.userId,
        deviceId: impression.deviceId,
        sessionId: impression.sessionId,
        waitStateId: impression.waitStateId ?? '',
        eventType: 'wait_state_start',
      },
      orderBy: { createdAt: 'desc' },
    });
    const waitSignals = (
      (waitStartForClick?.signals as unknown as WaitSignal[] | null) ?? []
    ).filter((s): s is WaitSignal => s && typeof s === 'object' && 'type' in s);
    const waitEvidence = (
      (waitStartForClick?.evidence as unknown as DetectorEvidence[] | null) ?? []
    ).filter((e): e is DetectorEvidence => e && typeof e === 'object' && 'type' in e);
    const clickAllowlist = this.runtimeConfig.getVerifiedDetectorVersions();
    const clickClassification = classifyWaitState(
      waitSignals,
      isVerifiedDetectorSource(waitStartForClick?.detectorVersion, clickAllowlist),
      waitEvidence,
    );
    if (
      isCpcBid &&
      (!clickClassification.adEligible || !(await this.hasVerifiedWaitAttestation(impression)))
    ) {
      return { clicked: false, reason: 'unverified_wait_attestation' };
    }
    const holdDays = this.ledger.getHoldDays(trustLevel, false);
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
            // Billing/analytics timestamps are server-authoritative. The
            // signed client value remains part of proof-of-possession, but a
            // compromised client cannot backdate/future-date click metrics.
            clickedAt: new Date(),
            targetUrl: creative.destinationUrl,
            idempotencyKey: dto.idempotencyKey,
          },
        });
        if (isCpcBid && split) {
          // Atomic budget guard for CPC clicks. Paused campaigns may still bill
          // a click served while active, but archived campaigns are terminal:
          // archiveCampaign fixes the unspent refund under this same row lock,
          // so accepting a later click would both refund and spend the same
          // minor units.
          const spent: number = await tx.$executeRaw`
            UPDATE "campaigns"
            SET "budgetSpentMinor" = "budgetSpentMinor" + ${BigInt(impression.campaign.bidAmountMinor)}
            WHERE "id" = ${impression.campaignId}
              AND "status" <> 'archived'
              AND "budgetSpentMinor" + ${BigInt(impression.campaign.bidAmountMinor)} <= "budgetTotalMinor"
          `;
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
          // `isBillable` is an accounting assertion, not a UI state: flip it
          // only inside the transaction that wrote every corresponding ledger
          // row. A rollback leaves the qualified CPC impression non-billable.
          const billedAt = new Date();
          await tx.adImpression.update({
            where: { id: impression.id },
            data: {
              isBillable: true,
              billingAuthorizedAt: billedAt,
              billedAt,
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
