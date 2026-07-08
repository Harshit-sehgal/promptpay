import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ConflictException, UnauthorizedException, Logger } from '@nestjs/common';
import { BidType, Prisma, ToolTypeEnum } from '@waitlayer/db';
import { LRUCache } from 'lru-cache';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { PLATFORM_BUCKETS } from '../ledger/ledger.constants';
import { FraudService } from '../fraud/fraud.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PROHIBITED_DATA_FIELDS, MINIMUM_VISIBLE_DURATION_MS, verifySignature } from '@waitlayer/shared';
import { isUniqueConstraintViolation, isSerializationError } from '../common/utils/errors';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { normalizeCreativeDestination } from '../common/utils/external-url-policy';
import { isActiveAccountStatus } from '../common/utils/account-status';

class BudgetExhaustedError extends Error {
  constructor() {
    super('Campaign budget exhausted or campaign inactive');
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * When the extension reports a wait_state_end, its claimed duration must
 * agree with the server-computed delta from the matching start event.
 * Network-and-scheduling latency and small clock skew are tolerated; this
 * constant sets the maximum tolerable drift in seconds. Anything larger is
 * treated as tampering and the request is rejected.
 */
const WAIT_STATE_DURATION_TOLERANCE_SECONDS = 30;

/** Hard cap on a single wait_state duration (24 hours). */
const WAIT_STATE_MAX_DURATION_SECONDS = 86_400;

/** Max retries on a serializable transaction conflict (PostgreSQL serialization failure). */
const FREQUENCY_CAP_TXN_MAX_RETRIES = 3;

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
  // LRU-bounded cache of served ads keyed by `(idempotencyKey, waitStateId)`.
  //
  // The previous implementation used a Map<String, ...> with a 60-second
  // read-side TTL but NO upper bound on size. Every ad served seeded two
  // new entries (one per key alias) and stale entries were only read-thrown
  // away on access — never actively evicted. A long-running API process
  // accumulated every idempotencyKey × waitStateId it ever served, growing
  // the heap unboundedly until the process was OOM-killed. This is a slow
  // in-memory DoS: even a single attacker hitting /extension/ad-request
  // with unique keys every minute would force an API restart within hours.
  //
  // The bounded LRU caps memory at `AD_CACHE_MAX` entries (10k) and evicts
  // the least-recently-used. The TTL is still 60s — older than that the
  // server already considers the inserted impression closed and a cache
  // hit would let the caller bypass "no eligible ad right now" responses.
  private adCache = new LRUCache<string, { ad: ServedAd }>({
    max: 10_000,
    ttl: 60_000,
  });
  private readonly logger = new Logger(ExtensionService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ledger: LedgerService,
    private fraud: FraudService,
    private googleVerifier: GoogleTokenVerifier,
  ) {}

  // ── Device Registration ──

  async registerDevice(userId: string, dto: {
    toolType: string;
    fingerprintHash: string;
    extensionVersion?: string;
    platform?: string;
    publicKey?: string;
    existingEventSecret?: string;
    recoveryPassword?: string;
    recoveryGoogleIdToken?: string;
    recoverySupportToken?: string;
  }) {
    // Privacy: reject payloads containing prohibited data fields
    this.enforcePrivacyOn(dto);
    // Check for duplicate device (same user + same fingerprint = re-registration).
    const existingDevice = await this.prisma.device.findUnique({
      where: { userId_fingerprintHash: { userId, fingerprintHash: dto.fingerprintHash } },
    });

    if (existingDevice) {
      if (!existingDevice.eventSecret) {
        // Legacy rows created before per-device secrets cannot authenticate
        // event payloads anymore. Issue a one-time secret to the authenticated
        // same-user owner so the device can migrate without keeping the global
        // HMAC fallback alive.
        const migratedSecret = crypto.randomBytes(32).toString('hex');
        const updated = await this.prisma.device.update({
          where: { id: existingDevice.id },
          data: {
            toolType: dto.toolType as ToolTypeEnum,
            extensionVersion: dto.extensionVersion,
            platform: dto.platform,
            eventSecret: migratedSecret,
            lastSeenAt: new Date(),
          },
        });
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'legacy_device_secret_issued',
          targetType: 'device',
          targetId: existingDevice.id,
          afterSnap: { fingerprintHash: dto.fingerprintHash },
        });
        return { ...updated, eventSecret: migratedSecret };
      }

      // Re-registration rotates the per-device secret. Any leaked token from
      // the old extension install is invalidated by this one-time reveal.
      //
      // CRITICAL: require proof-of-possession of the previously-issued secret
      // before rotating. If the local secret was lost during reinstall, allow
      // a deliberately stronger recovery path: same authenticated user, same
      // fingerprint, and fresh account re-authentication. Password accounts
      // prove that with the account password; linked Google accounts prove it
      // with a matching Google ID token; support/admin can issue a short-lived
      // one-time recovery token for future non-Google passwordless accounts.
      // That avoids restoring the removed global-HMAC fallback while still
      // giving real users a way out.
      const hasExistingSecretProof = hasMatchingSecret(dto.existingEventSecret, existingDevice.eventSecret);
      let recoveryMode: 'event_secret' | 'password' | 'google' | 'support' = 'event_secret';
      if (!hasExistingSecretProof) {
        recoveryMode = await this.assertDeviceRecoveryProof(userId, dto, existingDevice.id);
      }

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
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: recoveryMode === 'event_secret' ? 'device_secret_rotated' : 'device_secret_recovered',
        targetType: 'device',
        targetId: existingDevice.id,
        afterSnap: { recoveryMode },
      });
      return { ...updated, eventSecret: rotatedSecret };
    }

    // Cross-user instructions: the @@unique([fingerprintHash]) constraint at
    // the schema level means two different users CANNOT register the same
    // machine fingerprint concurrently — the second create hits P2002 (unique
    // violation). We catch that and translate it into a "duplicate_device"
    // fraud flag + audit entry. This is the DB-level TOCTOU guard that
    // supersedes the prior JS-level check, which raced between two users
    // simultaneously registering the same fingerprint.
    const eventSecret = crypto.randomBytes(32).toString('hex');
    let device;
    try {
      device = await this.prisma.device.create({
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
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Look up the existing owner of this fingerprint to record fraud.
        const otherDevice = await this.prisma.device.findFirst({
          where: { fingerprintHash: dto.fingerprintHash },
        });
        if (otherDevice) {
          await this.prisma.fraudFlag.create({
            data: {
              userId,
              deviceId: otherDevice.id,
              flagType: 'duplicate_device',
              severity: 'medium',
              evidence: {
                fingerprintHash: dto.fingerprintHash,
                otherUserId: otherDevice.userId,
                otherDeviceId: otherDevice.id,
              },
            },
          });
          this.audit.log({
            actorId: userId,
            actorRole: 'developer',
            action: 'duplicate_device_rejected',
            targetType: 'device',
            targetId: otherDevice.id,
            afterSnap: { otherUserId: otherDevice.userId, fingerprintHash: dto.fingerprintHash },
          });
        }
        throw new ForbiddenException(
          'This device fingerprint is already registered to another account. Each device may only be linked to one WaitLayer account.',
        );
      }
      throw err;
    }

    return { ...device, eventSecret };
  }

  private async assertDeviceRecoveryProof(
    userId: string,
    dto: { recoveryPassword?: string; recoveryGoogleIdToken?: string; recoverySupportToken?: string },
    deviceId: string,
  ): Promise<'password' | 'google' | 'support'> {
    const proofCount = [
      dto.recoveryPassword,
      dto.recoveryGoogleIdToken,
      dto.recoverySupportToken,
    ].filter(Boolean).length;
    if (proofCount === 0) {
      throw new UnauthorizedException('Cannot recover device secret without the existing device secret, account password, Google re-auth token, or support recovery token');
    }
    if (proofCount > 1) {
      throw new BadRequestException('Provide only one device recovery proof');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, googleId: true, email: true },
    });
    if (!user) {
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'device_secret_recovery_rejected',
        targetType: 'device',
        targetId: deviceId,
        afterSnap: { reason: 'user_not_found' },
      });
      throw new UnauthorizedException('Device recovery user was not found');
    }

    if (dto.recoveryPassword) {
      if (!user.passwordHash) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'password_unavailable' },
        });
        throw new UnauthorizedException('Password re-authentication is required to recover this device');
      }

      const passwordOk = await bcrypt.compare(dto.recoveryPassword, user.passwordHash);
      if (!passwordOk) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'password_mismatch' },
        });
        throw new UnauthorizedException('Password re-authentication failed');
      }
      return 'password';
    }

    if (dto.recoveryGoogleIdToken) {
      if (!user.googleId) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'google_unavailable' },
        });
        throw new UnauthorizedException('Google re-authentication is not available for this account');
      }

      const googlePayload = await this.googleVerifier.verify(dto.recoveryGoogleIdToken);
      if (!googlePayload.email_verified || googlePayload.sub !== user.googleId || googlePayload.email !== user.email) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: {
            reason: 'google_mismatch',
            googleSub: googlePayload.sub,
            googleEmail: googlePayload.email,
          },
        });
        throw new UnauthorizedException('Google re-authentication failed');
      }
      return 'google';
    }

    const tokenHash = hashDeviceRecoveryToken(dto.recoverySupportToken!);
    const recoveryToken = await this.prisma.deviceRecoveryToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        deviceId: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    });
    const now = new Date();
    if (
      !recoveryToken ||
      recoveryToken.userId !== userId ||
      recoveryToken.deviceId !== deviceId ||
      recoveryToken.usedAt ||
      recoveryToken.revokedAt ||
      recoveryToken.expiresAt <= now
    ) {
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'device_secret_recovery_rejected',
        targetType: 'device',
        targetId: deviceId,
        afterSnap: { reason: 'support_token_invalid_or_expired' },
      });
      throw new UnauthorizedException('Support recovery token is invalid or expired');
    }

    const consumed = await this.prisma.deviceRecoveryToken.updateMany({
      where: {
        id: recoveryToken.id,
        userId,
        deviceId,
        tokenHash,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'device_secret_recovery_rejected',
        targetType: 'device',
        targetId: deviceId,
        afterSnap: { reason: 'support_token_race_lost' },
      });
      throw new UnauthorizedException('Support recovery token is invalid or expired');
    }
    return 'support';
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
    this.enforcePrivacyOn(dto);
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
    durationSeconds: string | number;
    idempotencyKey: string;
    signature: string;
  }) {
    this.enforcePrivacyOn(dto);
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

    const claimedDurationSeconds = typeof dto.durationSeconds === 'string' ? parseInt(dto.durationSeconds, 10) : dto.durationSeconds;
    if (Number.isNaN(claimedDurationSeconds) || claimedDurationSeconds < 0 || claimedDurationSeconds > WAIT_STATE_MAX_DURATION_SECONDS) {
      throw new BadRequestException('Invalid duration value');
    }

    // Server-compute the duration from the start event's createdAt to now.
    // The client-claimed duration is allowed only within a small
    // tolerance window — this blocks attempts to extend
    // earnings-credit-eligible time on a session that actually ended long
    // ago, while still tolerating clock skew and event-delivery latency on
    // the extension side. The stored duration is the server-computed value
    // — the claimed value is only used for the consistency check.
    const serverDuration = Math.floor((Date.now() - start.createdAt.getTime()) / 1000);
    const drift = Math.abs(serverDuration - claimedDurationSeconds);
    if (drift > WAIT_STATE_DURATION_TOLERANCE_SECONDS) {
      throw new BadRequestException(
        `Duration mismatch (claimed=${claimedDurationSeconds}s, server=${serverDuration}s, tolerance=${WAIT_STATE_DURATION_TOLERANCE_SECONDS}s)`,
      );
    }
    const duration = serverDuration;

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
    const cached = this.adCache.get(dto.idempotencyKey) ?? this.adCache.get(dto.waitStateId);
    if (cached) {
      return { ad: cached.ad };
    }

    // Build campaign query with frequency capping
    const maxPerHour = settings?.maxAdsPerHour ?? 6;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find active campaigns with approved creatives (outside the critical
    // section — read-mostly data, no contention).
    const recentBillableCampaignIds = await this.recentBillableCampaignIds(userId, oneHourAgo);
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
      if (c.budgetSpentMinor >= c.budgetTotalMinor) return false;
      // Category filter
      if (dto.blockedCategories?.length && dto.blockedCategories.includes(c.category)) return false;
      if (dto.allowedCategories?.length && !dto.allowedCategories.includes(c.category)) return false;
      return true;
    });

    if (!initialEligible.length) {
      return { ad: null, reason: 'no_eligible_campaign' };
    }

    // Filter by advertiser balance to prevent serving ads for advertisers with negative/zero balance
    const advertiserIds = initialEligible.map((c) => c.advertiserId);
    const advertiserLedgerSums = await this.prisma.advertiserLedger.groupBy({
      by: ['advertiserId', 'entryType'],
      where: {
        advertiserId: { in: advertiserIds },
        status: 'confirmed',
      },
      _sum: { amountMinor: true },
    });

    const advertiserBalances = new Map<string, number>();
    for (const row of advertiserLedgerSums) {
      const current = advertiserBalances.get(row.advertiserId) ?? 0;
      const amount = row._sum.amountMinor ?? 0;
      if (row.entryType === 'credit') advertiserBalances.set(row.advertiserId, current + amount);
      if (row.entryType === 'debit') advertiserBalances.set(row.advertiserId, current - amount);
    }

    const eligible = initialEligible.filter((c) => {
      const balance = advertiserBalances.get(c.advertiserId) ?? 0;
      return balance >= c.bidAmountMinor;
    });

    if (!eligible.length) {
      return { ad: null, reason: 'no_eligible_campaign' };
    }

    // Weighted selection by bid. If every eligible campaign has bid 0 the
    // weighted RNG collapses to "always pick the first" — which is OK as
    // long as eligible is non-empty, but falls through here only when
    // totalBid happens to round to zero. In that case pick uniformly to
    // avoid deterministic over-serving of the first campaign encountered.
    const totalBid = eligible.reduce((sum, c) => sum + c.bidAmountMinor, 0);
    let selected: (typeof eligible)[number];
    if (totalBid === 0) {
      selected = eligible[Math.floor(Math.random() * eligible.length)];
    } else {
      let random = Math.random() * totalBid;
      selected = eligible[0];
      for (const c of eligible) {
        random -= c.bidAmountMinor;
        if (random <= 0) { selected = c; break; }
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
    // these after 60s — older than that there's no valid request anyway.
    this.adCache.set(dto.idempotencyKey, { ad });
    this.adCache.set(dto.waitStateId, { ad });

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
   * Read the set of distinct campaigns shown to this user in the last hour,
   * counting only billable impressions. Non-billable impressions (fraud-flagged,
   * budget-exhausted) must not consume the cap — otherwise a burst of rejected
   * impressions blocks the user from earning legitimate ones for the rest of
   * the hour. Read outside the critical section: it's read-mostly and the
   * authoritative cap gate lives in claimImpression's transaction.
   */
  private async recentBillableCampaignIds(userId: string, oneHourAgo: Date): Promise<string[]> {
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
  private async claimImpression(args: {
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
    | { status: 'claimed'; impressionId: string }
    | { status: 'duplicate' }
    | { status: 'cap_reached' }
  > {
    return this.prisma.$transaction(
      async (tx) => {
        // Per-user advisory lock. Hash the userId (a UUID string) into a
        // 32-bit bigint key for pg_advisory_xact_lock — collisions are
        // acceptable; two users hashing to the same key just queue briefly.
        const lockKey = BigInt('0x' + crypto.createHash('sha256').update(args.userId).digest('hex').slice(0, 8));
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

        // Idempotency check inside the lock — an earlier-arrived request
        // that INSERTed before we acquired the lock is now visible, so we
        // detect it here rather than racing the cap.
        const existing = await tx.adImpression.findFirst({
          where: {
            userId: args.userId,
            OR: [
              { idempotencyKey: args.idempotencyKey },
              { waitStateId: args.waitStateId },
            ],
          },
          select: { id: true },
        });
        if (existing) return { status: 'duplicate' as const };

        // Authoritative cap count inside the lock — billable impressions in
        // the last hour. Non-billable impressions don't consume the cap.
        const recentCount = await tx.adImpression.count({
          where: {
            userId: args.userId,
            isBillable: true,
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );
  }

  // ── Ad Event Tracking ──

  async recordRendered(userId: string, dto: {
    impressionToken: string;
    renderedAt: string;
    visibleSurface?: number;
    idempotencyKey: string;
    signature: string;
  }) {
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
    if (!await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature)) {
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

    // Must meet minimum visible duration. Also clamp against the elapsed
    // server time since `renderedAt` to prevent the client from claiming
    // more visible time than wall-clock could have elapsed. The claim is
    // accepted when it is within a generous grace window (5s above elapsed)
    // OR when the elapsed is too small to be meaningful (sub-second render
    // → qualify timestamps) — in the latter case we trust the claim since
    // there's no server-side clock to refute it.
    let effectiveDurationMs = dto.visibleDurationMs;
    if (impression.renderedAt) {
      const elapsedServer = Date.now() - impression.renderedAt.getTime();
      if (elapsedServer > 1_000 && dto.visibleDurationMs > elapsedServer + 5_000) {
        effectiveDurationMs = elapsedServer;
      }
    }

    if (effectiveDurationMs < MINIMUM_VISIBLE_DURATION_MS) {
      return {
        qualified: false,
        reason: 'minimum_duration_not_met',
        minimumRequired: MINIMUM_VISIBLE_DURATION_MS,
        actual: effectiveDurationMs,
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

    if (impression.campaign.bidType !== 'cpc') {
      const advertiserBalance = await this.getAdvertiserBalance(impression.campaign.advertiserId, impression.campaign.currency);
      if (advertiserBalance < impression.campaign.bidAmountMinor) {
        await this.prisma.adImpression.update({
          where: { id: impression.id },
          data: {
            qualifiedAt: new Date(dto.qualifiedAt),
            visibleDurationMs: dto.visibleDurationMs,
            isBillable: false,
            invalidationReason: 'insufficient_advertiser_balance',
          },
        });
        return { qualified: false, impressionId: impression.id, reason: 'insufficient_advertiser_balance' };
      }
    }

    // Look up the user's trust level for hold days
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId: impression.userId } });
    const trustLevel = trustScore?.level || 'new';

    const split = this.ledger.calculateSplit(impression.campaign.bidAmountMinor);
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

        // (2) Atomic spend increment — rejects when budget would overflow OR the
        // campaign is no longer `active`.
        const spent: number = await tx.$executeRawUnsafe(
          `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor" AND "status" = 'active'`,
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
            amountMinor: impression.campaign.bidAmountMinor,
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
      throw err;
    }

    if (billed === 'already_qualified') {
      return { qualified: true, impressionId: impression.id, alreadyQualified: true };
    }

    return { qualified: true, impressionId: impression.id };
  }

  async recordClick(userId: string, dto: {
    impressionToken: string;
    clickedAt: string;
    idempotencyKey: string;
    signature: string;
  }) {
    this.enforcePrivacyOn(dto);
    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
      include: {
        campaign: {
          select: { id: true, bidAmountMinor: true, currency: true, advertiserId: true, bidType: true },
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
    if (!await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature)) {
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
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId: impression.userId } });
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
            targetUrl: creative.destinationUrl,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        if (isCpcBid && split) {
          // Atomic budget guard for CPC clicks — same pattern as CPM above,
          // including the `status = 'active'` TOCTOU guard against
          // concurrent archive/pause.
          const spent: number = await tx.$executeRawUnsafe(
            `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor" AND "status" = 'active'`,
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
      if (isUniqueConstraintViolation(error)) {
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
    signature: string;
  }) {
    this.enforcePrivacyOn(dto);
    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (impression.userId !== userId) {
      throw new ForbiddenException('You do not own this impression');
    }

    // Verify device signature — otherwise an attacker who learns an impressionToken
    // could invalidate a legitimate impression and block the owner's earnings.
    const { signature: _, ...payload } = dto;
    if (!await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature)) {
      throw new ForbiddenException('Invalid request signature');
    }

    // Create report and invalidate the impression. If the impression was
    // already billed (isBillable=true), we must also reverse the ledger
    // entries — otherwise the advertiser stays debited, the developer keeps
    // earnings, and platform keeps fee + fraud_reserve for an impression we
    // now believe was invalid (3-way money orphan). reverseEarnings is
    // idempotent (deterministic `-rev` idempotency keys with upsert no-op),
    // so calling it when no ledger rows exist yet (impression reported
    // before qualification billed it) is a safe no-op. Guard on the prior
    // isBillable value so we don't reverse twice for a re-report (a second
    // report on an already-invalidated impression sees isBillable=false and
    // skips the reverse — the first report already did it).
    const wasBillable = impression.isBillable;
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

    // Reverse the money only if this impression had been billed. A
    // reported-but-not-yet-qualified impression has no ledger rows to
    // reverse. reverseEarnings leaves 'paid' developer entries in place
    // (matureEarnings already moved them past reversal) — those require a
    // separate claw-back flow documented in the ledger; the surface here
    // reports `paidSkipped` so the caller/operator knows money already left.
    if (wasBillable) {
      const result = await this.ledger.reverseEarnings(
        { impressionId: impression.id },
        `User-reported ad: ${dto.reason}`,
      );
      if (result.paidSkipped > 0) {
        this.logger.warn(
          `reportAd: ${result.paidSkipped} paid earnings entry(ies) for impression ${impression.id} could not be reversed (already paid out)`,
        );
      }
    }

    // Audit log for ad report (security-relevant: impression invalidated)
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'report_ad',
      targetType: 'impression',
      targetId: impression.id,
      afterSnap: { reason: dto.reason, invalidated: true },
    });

    return report;
  }

  // Rate-limited audit logging for signature rejections to prevent audit log flood
  // Tracks (reason, deviceId) pairs and limits to at most 1 log per 60 seconds per pair.
  private recentAuditRejections = new LRUCache<string, boolean>({ max: 500, ttl: 60_000 });

  private async rateLimitedAuditRejection(
    reason: string,
    deviceId: string,
    userId: string,
  ): Promise<void> {
    const dedupKey = `${reason}:${deviceId}`;
    if (this.recentAuditRejections.has(dedupKey)) return;
    this.recentAuditRejections.set(dedupKey, true);
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'device_signature_rejected',
      targetType: 'device',
      targetId: deviceId,
      afterSnap: { reason },
    });
  }

  // ── HMAC Signature Verification ──

  /** Verify an event payload signature using the device-specific secret.
   *
   *  Authentication policy:
   *    1. `deviceId` is REQUIRED. Null/missing device → reject (return false).
   *       No event is accepted from an anonymous (no-device) caller. Every
   *       event-recording path in this service resolves a real device row
   *       (the impression's or start-event's deviceId) before verifying, so
   *       a null deviceId here means a caller forgot to resolve the device —
   *       treat it as unauthorized rather than silently authenticating via
   *       the global fall-back key.
   *    2. If the device row has an `eventSecret`, ONLY that per-device secret
   *       is accepted. The global HMAC is rejected even on a device-secret
   *       mismatch — a known device secret must not be forgeable by the
   *       global fallback key.
   *    3. If the device row exists but has no `eventSecret` (a legacy row
   *       that pre-dates per-device secrets), reject and require device
   *       re-registration. The registration path can issue a one-time
   *       per-device secret to the authenticated same-user owner.
   *
   *  The permanent anonymous (no-device) global-key fallback was removed: a
   *  null deviceId previously authenticated via the shared global HMAC,
   *  which would let any party that learns the global key forge events with
   *  no device binding. Reject instead. */
  async verifyDeviceSignature(deviceId: string | null, payload: Record<string, unknown>, signature: string): Promise<boolean> {
    // No device → no authentication. Do not fall back to the global HMAC for
    // anonymous callers.
    if (!deviceId) {
      // Audit-log null-device attempts: a misconfigured client would hit this
      // path constantly (no-ops), but a forge / replay attempt by an attacker
      // who learned deviceIds but no secrets would also fail here. Sampling
      // keeps noise low while preserving the signal.
      // Rate-limited: at most 1 entry per 60s per (reason, deviceId) pair.
      await this.rateLimitedAuditRejection('null_device_id', 'null', 'anonymous');
      return false;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { eventSecret: true, userId: true },
    });
    if (!device) {
      // Rate-limited: at most 1 entry per 60s per (reason, deviceId) pair.
      await this.rateLimitedAuditRejection('unknown_device', deviceId, 'anonymous');
      return false; // unknown device → reject
    }

    if (device.eventSecret) {
      const ok = verifySignature(payload, device.eventSecret, signature);
      if (!ok) {
        // A device with a known secret submitted an unverifiable signature —
        // either a stale secret (post-rotation, pre-issuance) or an active
        // forgery attempt. Rate-limited: at most 1 entry per 60s per pair.
        await this.rateLimitedAuditRejection('device_secret_mismatch', deviceId, device.userId);
      }
      return ok;
    }

    // Rate-limited: at most 1 entry per 60s per (reason, deviceId) pair.
    await this.rateLimitedAuditRejection('missing_device_secret', deviceId, device.userId);
    return false;
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

  /** Typed wrapper around enforcePrivacy that avoids unsafe casts — spreads into a plain object */
  private enforcePrivacyOn<T extends object>(dto: T): void {
    this.enforcePrivacy({ ...dto } as Record<string, unknown>);
  }

  private async getAdvertiserBalance(advertiserId: string, currency: string): Promise<number> {
    const sums = await this.prisma.advertiserLedger.groupBy({
      by: ['entryType'],
      where: {
        advertiserId,
        currency,
        status: 'confirmed',
      },
      _sum: { amountMinor: true },
    });
    let deposits = 0;
    let charges = 0;
    for (const row of sums) {
      if (row.entryType === 'credit') deposits = row._sum.amountMinor ?? 0;
      if (row.entryType === 'debit') charges = row._sum.amountMinor ?? 0;
    }
    return deposits - charges;
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

}

function hasMatchingSecret(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function hashDeviceRecoveryToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
