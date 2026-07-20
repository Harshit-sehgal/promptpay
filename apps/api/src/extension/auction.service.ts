import * as crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { BidType, Prisma } from '@waitlayer/db';
import { nextBillableCharge, selectCampaignIndex } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { getAdvertiserBalancesByCurrency } from '../common/utils/advertiser-balance';
import { isSerializationError } from '../common/utils/errors';
import { normalizeCreativeDestination } from '../common/utils/external-url-policy';
import { PrismaService } from '../config/prisma.service';
import { isCountryEligible } from './country-targeting';
import {
  adCacheKey,
  adIdempotencyCacheKey,
  FREQUENCY_CAP_TXN_MAX_RETRIES,
  isCategoryBlocked,
  ServedAd,
} from './extension.constants';
import { isUnderFrequencyCap } from './frequency-cap';

/** A campaign as selected for the weighted auction (subset of the Prisma row). */
export interface AuctionCreative {
  id: string;
  title: string;
  sponsoredMessage: string;
  displayDomain: string | null;
  destinationUrl: string;
  ctaText: string | null;
  [key: string]: unknown;
}

export interface AuctionCampaign {
  id: string;
  advertiserId: string;
  name: string;
  status: string;
  category: string;
  bidType: BidType;
  bidAmountMinor: bigint;
  budgetTotalMinor: bigint;
  budgetSpentMinor: bigint;
  budgetReservedMinor: bigint;
  currency: string;
  frequencyCapPerHour: number | null;
  frequencyCapPerDay: number | null;
  creatives: AuctionCreative[];
  countryTargeting: unknown;
}

export interface SelectEligibleCampaignParams {
  userId: string;
  effectiveBlocked: string[];
  allowedCategories?: string[];
  userCountry?: string;
  oneHourAgo: Date;
  oneDayAgo: Date;
}

export interface ClaimImpressionArgs {
  userId: string;
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  idempotencyKey: string;
  campaignId: string;
  creativeId: string;
  impressionTokenHash: string;
  bidType: BidType;
  bidAmountMinor: bigint;
  maxPerHour: number;
  oneHourAgo: Date;
}

export type ClaimImpressionResult =
  | { status: 'claimed'; impressionId: string }
  | { status: 'duplicate' }
  | { status: 'cap_reached' }
  | { status: 'budget_unavailable' };

export interface RunAuctionParams {
  eligible: AuctionCampaign[];
  userId: string;
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  idempotencyKey: string;
  maxPerHour: number;
  oneHourAgo: Date;
  adCache: LRUCache<string, { ad: ServedAd }>;
  claimImpression: (args: ClaimImpressionArgs) => Promise<ClaimImpressionResult>;
}

/**
 * Campaign AUCTION-SELECTION responsibility (P2.1 extraction).
 *
 * Extracted verbatim from `ExtensionAdTrait.requestAd` so the ad-serving
 * orchestration (privacy, device/signature/wait-state gating, kill-switches)
 * stays in the trait while the pure selection logic — fetch eligible
 * campaigns, filter by budget/category/country/frequency/balance, run the
 * currency-safe weighted auction, and retry on reservation loss — lives here.
 * Runtime behavior is identical to the previous inline implementation.
 */
@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Fetch active campaigns with approved creatives and filter them down to the
   * eligible set: budget headroom (spent + reserved + next charge ≤ total),
   * category allow/block, country targeting, per-campaign frequency caps, and
   * per-currency advertiser balance.
   */
  async selectEligibleCampaign(params: SelectEligibleCampaignParams): Promise<AuctionCampaign[]> {
    const { userId, effectiveBlocked, allowedCategories, userCountry, oneHourAgo, oneDayAgo } =
      params;

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

    // Build the where clause with as many filters as possible BEFORE the
    // candidate limit so eligible campaigns are not excluded by an arbitrary
    // take cap. Category filtering, frequency-de-dup, and the active-status
    // gate all go into the query. Budget, country targeting, and per-campaign
    // frequency caps are applied post-query.
    const campaignWhere: Prisma.CampaignWhereInput = {
      status: 'active',
      // Frequency cap: don't show same campaign within the hour
      id: { notIn: await this.recentBillableCampaignIds(userId, oneHourAgo) },
    };
    // Category filter: exclude blocked categories in the DB query itself
    if (effectiveBlocked.length > 0) {
      campaignWhere.category = { notIn: effectiveBlocked };
    }
    // If the client supplied an allow-list, restrict to those categories
    if (allowedCategories?.length) {
      campaignWhere.category = {
        ...(campaignWhere.category as Prisma.StringFilter | undefined),
        in: allowedCategories,
      };
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: campaignWhere,
      // Use a single select so we can fetch budgetReservedMinor alongside
      // relations. Prisma forbids mixing top-level include and select.
      select: {
        id: true,
        advertiserId: true,
        name: true,
        status: true,
        category: true,
        bidType: true,
        bidAmountMinor: true,
        budgetTotalMinor: true,
        budgetSpentMinor: true,
        budgetReservedMinor: true,
        currency: true,
        frequencyCapPerHour: true,
        frequencyCapPerDay: true,
        creatives: {
          where: { status: 'approved' },
        },
        countryTargeting: true,
      },
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
      // Account for both committed spend and in-flight reservations. A campaign
      // that has *some* remaining budget but NOT enough to cover its exact next
      // billable charge must NOT win the auction (issue #2): otherwise it would
      // win, fail the guarded reservation, and cause the API to return no ad
      // without trying another eligible campaign. The next possible charge is
      // the per-event bid for both CPM (reserved at impression) and CPC (spent
      // at click) — see `nextBillableCharge`. Enforce spent + reserved + charge <= total.
      const charge = nextBillableCharge(BigInt(c.bidAmountMinor));
      if (
        BigInt(c.budgetSpentMinor) + BigInt(c.budgetReservedMinor ?? 0n) + charge >
        BigInt(c.budgetTotalMinor)
      )
        return false;
      // Category filter
      if (isCategoryBlocked(effectiveBlocked, c.category)) return false;
      if (allowedCategories?.length && !allowedCategories.includes(c.category)) return false;
      // Country-targeting filter (issue A-056). Campaigns with no targeting
      // rows serve everywhere; include-lists restrict to listed countries and
      // exclude-lists block listed countries.
      if (!isCountryEligible(c as never, userCountry)) return false;
      // Per-campaign frequency caps (issue A-061). A cap of 0/undefined means
      // "no limit"; a positive cap is enforced against the user's served
      // impressions in the trailing hour and day.
      if (
        !isUnderFrequencyCap(
          c as never,
          campaignHourCounts.get(c.id) ?? 0,
          campaignDayCounts.get(c.id) ?? 0,
        )
      ) {
        return false;
      }
      return true;
    });
    if (!initialEligible.length) return [];

    // Filter by per-currency advertiser balance (issue A-039). Each campaign is
    // compared against its OWN currency balance, so an advertiser with plenty of
    // EUR but zero USD cannot serve a USD campaign.
    const advertiserIds = initialEligible.map((c) => c.advertiserId);
    const advertiserBalances = await getAdvertiserBalancesByCurrency(this.prisma, advertiserIds);
    const eligible = initialEligible.filter((c) => {
      const balance = BigInt(advertiserBalances.get(`${c.advertiserId}:${c.currency}`) ?? 0);
      return balance >= BigInt(c.bidAmountMinor);
    });

    return eligible as AuctionCampaign[];
  }

  private async recentBillableCampaignIds(userId: string, oneHourAgo: Date): Promise<string[]> {
    const recent = await this.prisma.adImpression.findMany({
      where: { userId, isBillable: true, createdAt: { gte: oneHourAgo } },
      select: { campaignId: true },
    });
    return [...new Set(recent.map((i: { campaignId: string }) => i.campaignId))];
  }

  /**
   * Run the currency-safe, bigint-safe weighted auction with retry-on-
   * reservation-loss. When the chosen campaign loses the in-transaction
   * reservation race, it is removed from the candidate set and selection is
   * retried — bounded by the number of eligible candidates so we never loop.
   * `no_eligible_campaign` is returned only after every viable candidate has
   * been exhausted. `claimImpression` is injected by the caller (the trait's
   * `claimImpression`, which owns the budget-reservation + insert critical
   * section) so this service stays a pure selection engine.
   */
  async runAuction(params: RunAuctionParams): Promise<{ ad: ServedAd | null; reason?: string }> {
    const {
      eligible,
      userId,
      deviceId,
      sessionId,
      waitStateId,
      idempotencyKey,
      maxPerHour,
      oneHourAgo,
      adCache,
      claimImpression,
    } = params;

    const excludedIds = new Set<string>();
    const MAX_CANDIDATE_ATTEMPTS = eligible.length;
    for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
      const pool = eligible.filter((c) => !excludedIds.has(c.id));
      if (pool.length === 0) break;
      const poolIndex = selectCampaignIndex(
        pool.map((c) => ({
          id: c.id,
          currency: c.currency,
          bidAmountMinor: BigInt(c.bidAmountMinor),
        })),
      );
      const selected = pool[poolIndex];
      const creative = selected.creatives[0];
      const impressionToken = crypto.randomUUID();
      const impressionTokenHash = crypto.createHash('sha256').update(impressionToken).digest('hex');
      const ad: ServedAd = {
        impressionToken,
        campaignId: selected.id,
        creativeId: creative.id,
        title: creative.title,
        message: creative.sponsoredMessage,
        label: 'Sponsored',
        displayDomain: creative.displayDomain ?? '',
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
      let claim: ClaimImpressionResult;
      let serRetries = 0;
      for (;;) {
        try {
          claim = await claimImpression({
            userId,
            deviceId,
            sessionId,
            waitStateId,
            idempotencyKey,
            campaignId: selected.id,
            creativeId: creative.id,
            impressionTokenHash,
            bidType: selected.bidType,
            bidAmountMinor: BigInt(selected.bidAmountMinor),
            maxPerHour,
            oneHourAgo,
          });
          break;
        } catch (err) {
          if (isSerializationError(err) && ++serRetries < FREQUENCY_CAP_TXN_MAX_RETRIES) {
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
      // The guard `budgetSpentMinor + budget_reserved_minor + charge <= budgetTotalMinor`
      // failed inside the transaction: a concurrent request took the last budget
      // (or the advertiser balance moved). Remove THIS campaign and try another
      // candidate rather than returning no ad (issue #2).
      if (claim.status === 'budget_unavailable') {
        excludedIds.add(selected.id);
        continue;
      }
      // Save to LRU cache for immediate retries. Both keys map to the same ad
      // so a retry on either lookup hits the bounded cache. LRU's TTL evicts
      // these after 60s — older than that there's no valid request anymore.
      // Keys are namespaced by userId + deviceId (issue A-038).
      adCache.set(adIdempotencyCacheKey(userId, deviceId, idempotencyKey), { ad });
      adCache.set(adCacheKey(userId, deviceId, waitStateId), { ad });
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
            deviceId,
            waitStateId,
          },
        });
      }
      return { ad };
    }
    return { ad: null, reason: 'no_eligible_campaign' };
  }
}
