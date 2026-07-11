import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { PAYOUT_HOLD_DAYS } from '@waitlayer/shared';
import { LedgerStatus, primaryCurrency } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { PLATFORM_BUCKETS } from './ledger.constants';

/** Valid earning state transitions */
const EARNING_TRANSITIONS: Partial<Record<LedgerStatus, LedgerStatus[]>> = {
  [LedgerStatus.ESTIMATED]: [
    LedgerStatus.PENDING,
    LedgerStatus.CONFIRMED,
    LedgerStatus.HELD,
    LedgerStatus.REVERSED,
    LedgerStatus.VOID,
  ],
  [LedgerStatus.PENDING]: [
    LedgerStatus.CONFIRMED,
    LedgerStatus.HELD,
    LedgerStatus.REVERSED,
    LedgerStatus.VOID,
  ],
  [LedgerStatus.CONFIRMED]: [
    LedgerStatus.HELD,
    LedgerStatus.PAID,
    LedgerStatus.REVERSED,
    LedgerStatus.VOID,
  ],
  [LedgerStatus.HELD]: [LedgerStatus.CONFIRMED, LedgerStatus.REVERSED, LedgerStatus.VOID],
  [LedgerStatus.PAID]: [],
  [LedgerStatus.REVERSED]: [],
  [LedgerStatus.VOID]: [],
};

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  private addCurrencyAmount(
    totals: Record<string, number>,
    currency: string | null | undefined,
    amountMinor: number,
  ) {
    const key = (currency || 'USD').toUpperCase();
    totals[key] = (totals[key] ?? 0) + amountMinor;
  }

  private addGroupedCurrencyTotals(
    totals: Record<string, number>,
    rows: Array<{ currency: string; _sum: { amountMinor: number | null } }>,
    multiplier = 1,
  ) {
    for (const row of rows) {
      this.addCurrencyAmount(totals, row.currency, (row._sum.amountMinor ?? 0) * multiplier);
    }
  }

  private nonNegativeCurrencyTotals(totals: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
      Object.entries(totals).map(([currency, amountMinor]) => [currency, Math.max(0, amountMinor)]),
    );
  }

  // ── Revenue Split ──

  /**
   * Calculate revenue split with optional launch incentive.
   *
   * Money is integer minor units; floating-point multiplication + Math.floor on
   * the cents yields platform/reserve shares that can be off-by-one relative to
   * the intended basis-point split (e.g. `0.3 * 101 = 30.2999...`). The remainder
   * was previously dumped into userShare, which silently funnelled rounding loss
   * to/from platform and reserve. We compute in integer basis points instead.
   */
  calculateSplit(bidAmountMinor: number, useLaunchIncentive = false) {
    // Guard: a non-positive bid would silently produce zero/negative platform
    // and reserve shares — a money-accounting bug. Refuse outright so callers
    // fail closed instead of writing a bogus split.
    if (!Number.isFinite(bidAmountMinor) || bidAmountMinor <= 0) {
      throw new BadRequestException(
        `calculateSplit requires a positive bid amount (got ${bidAmountMinor})`,
      );
    }

    // Split percentages expressed as basis points (1 bps = 0.01%). Sum to 10000
    // (100.00%) for both REVENUE_SPLIT and LAUNCH_INCENTIVE_SPLIT at the source —
    // no float round-trip through the constants.
    const USER_BPS = 6000;
    const PLATFORM_BPS = 3000;
    const RESERVE_BPS = 1000;
    const LAUNCH_USER_BPS = 8000;
    const LAUNCH_PLATFORM_BPS = 1000;
    const LAUNCH_RESERVE_BPS = 1000;

    const userBps = useLaunchIncentive ? LAUNCH_USER_BPS : USER_BPS;
    const platformBps = useLaunchIncentive ? LAUNCH_PLATFORM_BPS : PLATFORM_BPS;
    const reserveBps = useLaunchIncentive ? LAUNCH_RESERVE_BPS : RESERVE_BPS;

    // Integer partition: largest-share-first convention absorbs any rounding
    // remainder deterministically. With bidAmountMinor * any_bps deterministic
    // and 10000 dividing bidAmountMinor * 10000 exactly, only off-by-one from
    // floor() across the three shares can occur; we route it to user (largest)
    // so platform/reserve never get under-credited.
    const userShare = Math.floor((bidAmountMinor * userBps) / 10000);
    const platformShare = Math.floor((bidAmountMinor * platformBps) / 10000);
    const reserveShare = Math.floor((bidAmountMinor * reserveBps) / 10000);
    const remainder = bidAmountMinor - userShare - platformShare - reserveShare;
    return {
      userShare: userShare + remainder,
      platformShare,
      reserveShare,
    };
  }

  /** Get hold days based on trust level */
  getHoldDays(trustLevel: string): number {
    switch (trustLevel) {
      case 'high_trust':
        return PAYOUT_HOLD_DAYS.HIGH_TRUST;
      case 'normal':
        return PAYOUT_HOLD_DAYS.NORMAL;
      case 'new':
      case 'low_trust':
        return PAYOUT_HOLD_DAYS.NEW_ACCOUNT;
      // `RESTRICTED = -1` and `BANNED = -1` are the contract for "indefinite
      // hold — never mature". Falling through to the default here would
      // silently give restricted/banned users a 30-day hold, defeating the
      // policy. Keep the explicit cases.
      case 'restricted':
      case 'banned':
        return PAYOUT_HOLD_DAYS.RESTRICTED;
      default:
        return PAYOUT_HOLD_DAYS.NEW_ACCOUNT;
    }
  }

  // ── Recording Earnings ──

  /** Record impression earnings across all three ledgers atomically */
  async recordImpressionEarnings(params: {
    userId: string;
    campaignId: string;
    impressionId: string;
    bidAmountMinor: number;
    currency: string;
    advertiserId: string;
    trustLevel: string;
  }) {
    const { userId, campaignId, impressionId, bidAmountMinor, currency, advertiserId, trustLevel } =
      params;

    const split = this.calculateSplit(bidAmountMinor, process.env.LAUNCH_SPLIT_ENABLED === 'true');
    const holdDays = this.getHoldDays(trustLevel);
    // A negative hold-day (PAYOUT_HOLD_DAYS.RESTRICTED = -1) means "indefinite hold,
    // never mature". Storing availableAt:null keeps matureEarnings()'s `<= new Date()`
    // filter from ever advancing the row. New Date() with a negative offset would
    // land in the past and falsely match.
    const availableAt = holdDays < 0 ? null : new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `imp-${impressionId}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Atomic budget increment gated on:
      //   - the budget guard (no overspend), AND
      //   - the campaign still being `active`.
      // The `status = 'active'` clause closes a TOCTOU with `archiveCampaign`:
      // ad serving re-reads the campaign status only at request time, so a
      // campaign archived between requestAd and this record-time debit would
      // otherwise still accrue spend. With the status guard, an archived
      // campaign reports `spent === 0` here and we treat the impression as
      // non-billable (no advertiser debit, no developer credit) — the
      // impression row was already inserted at request time but isBillable
      // is the authoritative billability flag and is set false by callers
      // when this path throws `campaign_archived`.
      const spent: number = await tx.$executeRawUnsafe(
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor" AND "status" = 'active'`,
        bidAmountMinor,
        campaignId,
      );
      if (spent === 0) {
        // The increment failed — either budget exhausted or the campaign is
        // no longer active (paused/archived). Distinguish so callers can mark
        // the impression non-billable with the right reason rather than
        // retrying. We throw a typed error; the caller decides whether to
        // surface as 'budget_exhausted' or 'campaign_not_active' — for the
        // ledger path we use the existing 'budget exhausted' message which
        // callers already tolerate as a non-billable signal.
        throw new ConflictException('Campaign budget exhausted or no longer active');
      }

      // Debit advertiser
      await tx.advertiserLedger.create({
        data: {
          advertiserId,
          campaignId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: bidAmountMinor,
          currency,
          idempotencyKey: `${idempotencyBase}-adv`,
          description: `Impression charge - campaign ${campaignId}`,
        },
      });
      // Credit developer (estimated until matured)
      await tx.earningsLedger.create({
        data: {
          userId,
          campaignId,
          impressionId,
          entryType: 'credit',
          status: 'estimated',
          amountMinor: split.userShare,
          currency,
          availableAt,
          idempotencyKey: `${idempotencyBase}-usr`,
          description: 'Earnings from qualified impression',
        },
      });
      // Credit platform fee
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.platformShare,
          currency,
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          referenceId: impressionId,
          idempotencyKey: `${idempotencyBase}-plt`,
          description: 'Platform fee from impression',
        },
      });
      // Credit fraud/payment reserve
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.reserveShare,
          currency,
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          referenceId: impressionId,
          idempotencyKey: `${idempotencyBase}-res`,
          description: 'Fraud/payment reserve from impression',
        },
      });

      return { billed: true, split };
    });
  }

  /** Record click earnings (on top of impression) */
  async recordClickEarnings(params: {
    userId: string;
    campaignId: string;
    clickId: string;
    clickBidMinor: number;
    currency: string;
    advertiserId: string;
    trustLevel: string;
  }) {
    const { userId, campaignId, clickId, clickBidMinor, currency, advertiserId, trustLevel } =
      params;

    const split = this.calculateSplit(clickBidMinor, process.env.LAUNCH_SPLIT_ENABLED === 'true');
    const holdDays = this.getHoldDays(trustLevel);
    // Negative hold-day => indefinite hold (restricted trust level). See rationale on
    // recordImpressionEarnings; same handling here.
    const availableAt = holdDays < 0 ? null : new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    const idempotencyBase = `clk-${clickId}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Status guard — see the matching comment on recordImpressionEarnings.
      const spent: number = await tx.$executeRawUnsafe(
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1 WHERE "id" = $2 AND "budgetSpentMinor" + $1 <= "budgetTotalMinor" AND "status" = 'active'`,
        clickBidMinor,
        campaignId,
      );
      if (spent === 0) {
        throw new ConflictException('Campaign budget exhausted or no longer active');
      }

      // Debit advertiser for click
      await tx.advertiserLedger.create({
        data: {
          advertiserId,
          campaignId,
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: clickBidMinor,
          currency,
          idempotencyKey: `${idempotencyBase}-adv`,
          description: `Click charge - campaign ${campaignId}`,
        },
      });
      // Credit developer for click
      await tx.earningsLedger.create({
        data: {
          userId,
          campaignId,
          clickId,
          entryType: 'credit',
          status: 'estimated',
          amountMinor: split.userShare,
          currency,
          availableAt,
          idempotencyKey: `${idempotencyBase}-usr`,
          description: 'Earnings from ad click',
        },
      });
      // Credit platform fee
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.platformShare,
          currency,
          bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
          referenceId: clickId,
          idempotencyKey: `${idempotencyBase}-plt`,
          description: 'Platform fee from ad click',
        },
      });
      // Credit fraud/payment reserve
      await tx.platformLedger.create({
        data: {
          campaignId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: split.reserveShare,
          currency,
          bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
          referenceId: clickId,
          idempotencyKey: `${idempotencyBase}-res`,
          description: 'Fraud/payment reserve from ad click',
        },
      });

      return { billed: true, split };
    });
  }

  // ── State Transitions ──

  /** Mature estimated earnings to confirmed after hold period */
  async matureEarnings() {
    const updated = await this.prisma.earningsLedger.updateMany({
      where: {
        status: 'estimated',
        availableAt: { lte: new Date() },
      },
      data: { status: 'confirmed' },
    });
    return { matured: updated.count };
  }

  /** Transition a single earning entry to a new status (with validation).
   *
   *  Read-then-update is racy: two concurrent callers could both read an
   *  `estimated` row and both flip it to `held`, double-applying a hold.
   *  We validate the transition against the observed status (for a clear
   *  error message), then apply it with an atomic conditional UPDATE
   *  (`updateMany where id AND status === observedStatus`). If the row's
   *  status moved between the read and the write, count === 0 → the caller
   *  loses the race and we surface a ConflictException so it can retry. */
  async transitionEarning(entryId: string, newStatus: LedgerStatus, reason?: string) {
    const entry = await this.prisma.earningsLedger.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException(`Earning entry ${entryId} not found`);

    const allowed = EARNING_TRANSITIONS[entry.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid transition: ${entry.status} → ${newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }

    const result = await this.prisma.earningsLedger.updateMany({
      where: { id: entryId, status: entry.status },
      data: {
        status: newStatus,
        description: reason ? `${entry.description || ''} [${newStatus}: ${reason}]` : undefined,
      },
    });
    if (result.count === 0) {
      // The row's status changed between our read and the conditional
      // write — a concurrent transition won. Surface as a conflict so the
      // caller re-reads and decides whether to retry or no-op.
      throw new ConflictException(
        `Earning entry ${entryId} was modified by a concurrent transition; retry`,
      );
    }
    return this.prisma.earningsLedger.findUnique({ where: { id: entryId } });
  }

  /**
   * Hold all earnings for a user (e.g., during a critical fraud investigation).
   *
   *  When a `flagId` is supplied: held entries are stamped
   *  `heldByFlagId = flagId`. This is what scopes the corresponding
   *  `releaseEarnings` — releasing a false-positive flag F1 only releases
   *  the entries THIS flag held, never entries held under a still-open,
   *  unrelated flag F2 (cross-flag money leak). Without the flagId
   *  linkage the bulk release had no choice but to release every held
   *  entry across all of the user's flags.
   */
  async holdEarnings(userId: string, reason?: string, flagId?: string) {
    // CAS: only hold entries that aren't already stamped by another flag.
    // Without the heldByFlagId: null guard in the WHERE clause, two
    // concurrent critical fraud flags on the same user would both call
    // holdEarnings — F1 stamps everything, F2 arrives a millisecond later
    // and overwrites F1's heldByFlagId stamps with its own flagId. Later
    // when F1 is resolved as false-positive, releaseEarnings(scoped to F1)
    // finds zero matching entries (F2 overwrote all the stamps) → the
    // innocent user's earnings stay held forever (silent permanent freeze).
    // With this guard F2's updateMany returns count=0 for already-held
    // entries — it only holds the subset still unheld.
    return this.prisma.earningsLedger.updateMany({
      where: {
        userId,
        status: { in: ['estimated', 'pending', 'confirmed'] },
        heldByFlagId: null,
      },
      data: {
        status: 'held',
        description: reason ? `Held: ${reason}` : undefined,
        heldByFlagId: flagId ?? null,
      },
    });
  }

  /** Release held earnings after a fraud-flag review clears.
   *
   *  Two scopes are supported:
   *  - Per-impression (preferred when the flag links to a specific
   *    impression): only held earnings tied to that impression are
   *    flipped to `confirmed`. This avoids leaking legitimate holds
   *    from concurrent unrelated flags.
   *  - Per-flag fallback: used when the flag has no impressionId
   *    (e.g. click-pattern fraud without a specific impression). Released
   *    entries are scoped to `heldByFlagId = flagId` so the release can
   *    NEVER undo holds from a still-open concurrent flag — the previous
   *    bulk `WHERE userId AND status='held'` released every held entry
   *    across all of the user's flags (cross-flag money leak).
   *
   *  Either way the operation is idempotent (no-op when nothing matches).
   */
  async releaseEarnings(userId: string, opts?: { impressionId?: string; flagId?: string }) {
    if (opts?.impressionId) {
      return this.prisma.earningsLedger.updateMany({
        where: { userId, impressionId: opts.impressionId, status: 'held' },
        data: { status: 'confirmed', heldByFlagId: null },
      });
    }
    // Bulk user-level path is intentionally GONE. Releasing every held
    // entry across all flags was the cross-flag money leak. Without a
    // flagId OR impressionId we cannot scope safely — fail closed
    // (release nothing) rather than release unrelated holds. Admins can
    // still release a specific hold by resolving its flag (which carries
    // a flagId).
    if (!opts?.flagId) {
      return { count: 0 } satisfies { count: number };
    }
    return this.prisma.earningsLedger.updateMany({
      where: { userId, heldByFlagId: opts.flagId, status: 'held' },
      data: { status: 'confirmed', heldByFlagId: null },
    });
  }

  /**
   * Reverse earnings for a specific impression or click (confirmed fraud
   * or a legit user-initiated report).
   *
   * Sum-conserving: in addition to flipping the developer's earnings rows
   * to `reversed`, writes compensating entries so the per-entity
   * accounting reconciles to zero — the advertiser is refunded the full
   * bid, the platform's fee bucket is debited back, and the fraud/payment
   * reserve bucket is released. Without these the prior
   * `recordImpressionEarnings` / `recordClickEarnings` left money stranded
   * in the advertiser-debit and platform-credit buckets for a confirmed-
   * fraudulent entity.
   *
   * Policy (per the schema's existing `fraud_reserve` bucket — reserved
   * for fraud and payment claw-backs):
   *   - Advertiser: full `bidAmountMinor` refund (advertiser must not pay
   *     for fraud).
   *   - Platform fee / fraud reserve: full debit-back (the platform did
   *     not legitimately earn fees on a fraudulent entity).
   *   - Developer: credit marked `reversed` (the share was never released
   *     to the developer — the developer's row was in `estimated` /
   *     `pending` / `confirmed`, not yet `paid`).
   *
   * Supports both `impressionId` and `clickId`. When both are provided,
   * clickId takes precedence (click-level rows are the finer-grained
   * money movement). The `imp-{id}` / `clk-{id}` base key determines
   * which compensation rows to look up; the matching `earnings_ledger`
   * column (`impressionId` or `clickId`) is used for the developer-row
   * flip.
   *
   * Entries already in `paid` status (developer already withdrew) remain
   * immutable because `paid` is a terminal state. For those, this method
   * writes a separate confirmed `debit` row against the same user/entity
   * as recovery debt. Payout availability subtracts those debits, so later
   * withdrawals are reduced automatically while the original paid row stays
   * audit-safe.
   *
   * Idempotent: every compensation entry uses a deterministic
   * `${base}-rev-${suffix}` idempotency key (`@unique`); a P2002 on any
   * one of them means a prior reversal already recorded the compensation
   * — the entry is silently skipped, the earnings flip is intrinsically
   * idempotent (`status: 'reversed'` is a terminal state).
   */
  async reverseEarnings(
    ref: { impressionId?: string; clickId?: string },
    reason?: string,
  ): Promise<{
    reversed: number;
    /** Entries left in 'paid' status — money already left, can't be clawed back by this method. */
    paidSkipped: number;
  }> {
    // clickId wins when both are present (finer-grained money movement).
    const isClick = !!ref.clickId;
    const entityId = ref.clickId || ref.impressionId;
    if (!entityId) {
      return { reversed: 0, paidSkipped: 0 };
    }
    const prefix = isClick ? 'clk' : 'imp';
    // The earnings_ledger column to key the developer-row flip on.
    const entityCol = isClick ? ('clickId' as const) : ('impressionId' as const);

    // Pre-flight: read the entity's advertiser-debit / platform-credit
    // rows so we know the exact amounts and advertiserId for the
    // compensation writes. The idempotency-key prefix mirrors the
    // forward `recordImpressionEarnings` / `recordClickEarnings` writes.
    const advBase = `${prefix}-${entityId}-adv`;
    const pltBase = `${prefix}-${entityId}-plt`;
    const resBase = `${prefix}-${entityId}-res`;
    const paidWhere: Prisma.EarningsLedgerWhereInput = {
      [entityCol]: entityId,
      status: 'paid',
      entryType: 'credit',
    };

    const [advDebit, pltCredit, resCredit, paidCount] = await Promise.all([
      this.prisma.advertiserLedger.findUnique({ where: { idempotencyKey: advBase } }),
      this.prisma.platformLedger.findUnique({ where: { idempotencyKey: pltBase } }),
      this.prisma.platformLedger.findUnique({ where: { idempotencyKey: resBase } }),
      this.prisma.earningsLedger.count({ where: paidWhere }),
    ]);

    const entityLabel = prefix === 'clk' ? 'click' : 'impression';

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Flip the developer's earnings rows to `reversed` — intrinsically
      //    idempotent: rows already `reversed` simply don't match the
      //    `status in (...)` filter.
      const reversed = await tx.earningsLedger.updateMany({
        where: {
          [entityCol]: entityId,
          status: { in: ['estimated', 'pending', 'confirmed'] },
        },
        data: {
          status: 'reversed',
          description: reason ? `Reversed: ${reason}` : undefined,
        },
      });

      // 2. Advertiser refund — full bid back to the advertiser.
      //    Skipped when the original row never recorded a matching
      //    advertiser debit (e.g. a hypothetical entry without a spend,
      //    or pre-existing data predating the schema).
      if (advDebit) {
        await tx.advertiserLedger.upsert({
          where: { idempotencyKey: `${advBase}-rev` },
          create: {
            advertiserId: advDebit.advertiserId,
            campaignId: advDebit.campaignId,
            entryType: 'refund',
            status: 'confirmed',
            amountMinor: advDebit.amountMinor,
            currency: advDebit.currency,
            idempotencyKey: `${advDebit.idempotencyKey}-rev`,
            description: `Refund — ${entityLabel} ${entityId} reversed${reason ? `: ${reason}` : ''}`,
          },
          update: {}, // idempotent: do nothing on a replay
        });
      }

      // 3. Platform fee reversal — debit the platform_fee bucket back.
      //    `entryType: 'reversal'` posts a debit-side offset to the prior
      //    `credit` (the platform marks the fee as never earned).
      if (pltCredit) {
        await tx.platformLedger.upsert({
          where: { idempotencyKey: `${pltBase}-rev` },
          create: {
            campaignId: pltCredit.campaignId,
            entryType: 'reversal',
            status: 'confirmed',
            amountMinor: pltCredit.amountMinor,
            currency: pltCredit.currency,
            bucket: PLATFORM_BUCKETS.PLATFORM_FEE,
            referenceId: entityId,
            idempotencyKey: `${pltCredit.idempotencyKey}-rev`,
            description: `Platform-fee reversal — ${entityLabel} ${entityId} reversed${reason ? `: ${reason}` : ''}`,
          },
          update: {},
        });
      }

      // 4. Fraud-reserve reversal — release the reserve bucket (it was set
      //    aside for exactly this purpose).
      if (resCredit) {
        await tx.platformLedger.upsert({
          where: { idempotencyKey: `${resBase}-rev` },
          create: {
            campaignId: resCredit.campaignId,
            entryType: 'reversal',
            status: 'confirmed',
            amountMinor: resCredit.amountMinor,
            currency: resCredit.currency,
            bucket: PLATFORM_BUCKETS.FRAUD_RESERVE,
            referenceId: entityId,
            idempotencyKey: `${resCredit.idempotencyKey}-rev`,
            description: `Fraud-reserve release — ${entityLabel} ${entityId} reversed${reason ? `: ${reason}` : ''}`,
          },
          update: {},
        });
      }

      // 5. Paid-entry recovery debt. We do not mutate the original `paid`
      //    credit row, but we do create an idempotent debit row so future
      //    payout availability nets against money already paid for fraud.
      if (paidCount > 0) {
        const paidEntries = await tx.earningsLedger.findMany({
          where: paidWhere,
          select: {
            id: true,
            userId: true,
            campaignId: true,
            impressionId: true,
            clickId: true,
            amountMinor: true,
            currency: true,
          },
        });

        for (const entry of paidEntries) {
          await tx.earningsLedger.upsert({
            where: { idempotencyKey: `${prefix}-${entityId}-paid-debt-${entry.id}` },
            create: {
              userId: entry.userId,
              campaignId: entry.campaignId,
              impressionId: entry.impressionId,
              clickId: entry.clickId,
              entryType: 'debit',
              status: 'confirmed',
              amountMinor: entry.amountMinor,
              currency: entry.currency,
              availableAt: null,
              idempotencyKey: `${prefix}-${entityId}-paid-debt-${entry.id}`,
              description: `Recovery debt for paid ${entityLabel} ${entityId}${reason ? `: ${reason}` : ''}`,
            },
            update: {},
          });
        }
      }

      return { reversed: reversed.count, paidSkipped: paidCount };
    });
  }

  // ── Balance Queries ──

  /** Get total confirmed (available) earnings for a user */
  async getAvailableBalance(
    userId: string,
  ): Promise<{ amountMinor: number; currency: string; byCurrency: Record<string, number> }> {
    const [credits, debits] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const totals: Record<string, number> = {};
    this.addGroupedCurrencyTotals(totals, credits);
    this.addGroupedCurrencyTotals(totals, debits, -1);
    const byCurrency = this.nonNegativeCurrencyTotals(totals);
    // Derive the primary currency from the user's ACTUAL balance
    // (largest positive), not a hardcoded 'USD'. Fixes the
    // multi-currency bug where a developer with only EUR
    // earnings saw `amountMinor: 0, currency: 'USD'`.
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0,
      currency,
      byCurrency,
    };
  }

  /** Get total pending (estimated + confirmed) earnings for a user */
  async getPendingBalance(
    userId: string,
  ): Promise<{ amountMinor: number; currency: string; byCurrency: Record<string, number> }> {
    const result = await this.prisma.earningsLedger.groupBy({
      by: ['currency'],
      where: { userId, status: { in: ['estimated', 'pending'] }, entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    const byCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(byCurrency, result);
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0,
      currency,
      byCurrency,
    };
  }

  /** Get all-time total earnings for a user (excluding reversed/void) */
  async getTotalEarnings(
    userId: string,
  ): Promise<{ amountMinor: number; currency: string; byCurrency: Record<string, number> }> {
    const [credits, debits] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: { notIn: ['reversed', 'void'] }, entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: { notIn: ['reversed', 'void'] }, entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const totals: Record<string, number> = {};
    this.addGroupedCurrencyTotals(totals, credits);
    this.addGroupedCurrencyTotals(totals, debits, -1);
    const byCurrency = this.nonNegativeCurrencyTotals(totals);
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0,
      currency,
      byCurrency,
    };
  }

  /** Get breakdown of earnings by status for a user */
  async getEarningsBreakdown(userId: string) {
    const grouped = await this.prisma.earningsLedger.groupBy({
      by: ['status'],
      where: { userId, entryType: 'credit' },
      _sum: { amountMinor: true },
      _count: true,
    });

    return grouped.map((g) => ({
      status: g.status,
      amountMinor: g._sum.amountMinor || 0,
      count: g._count,
    }));
  }

  /** Get paid-out total for a user */
  async getPaidOutTotal(
    userId: string,
  ): Promise<{ amountMinor: number; currency: string; byCurrency: Record<string, number> }> {
    const result = await this.prisma.earningsLedger.groupBy({
      by: ['currency'],
      where: { userId, status: 'paid', entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    const byCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(byCurrency, result);
    const currency = primaryCurrency(byCurrency);
    return {
      amountMinor: byCurrency[currency] ?? 0,
      currency,
      byCurrency,
    };
  }

  /** Get earnings history with pagination */
  async getEarningsHistory(
    userId: string,
    page = 1,
    limit = 20,
    filters?: { ledgerKind?: string; status?: string },
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.EarningsLedgerWhereInput = { userId };
    if (filters?.status) where.status = filters.status as LedgerStatus;

    // This method is strictly for a user's own earnings history.
    // Admins should use getHistoryForAdmin directly.
    if (filters?.ledgerKind && filters.ledgerKind !== 'earnings') {
      throw new BadRequestException('Users can only query the earnings ledger.');
    }

    const [entries, total] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.earningsLedger.count({ where }),
    ]);

    return {
      entries,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getHistoryForAdmin(
    filters: { ledgerKind?: string; status?: string } | undefined,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const statusFilter = filters?.status ? { status: filters.status as LedgerStatus } : {};

    // Single-ledger views: paginate at the DB layer with a real total count.
    if (filters?.ledgerKind === 'platform') {
      const [rows, total] = await Promise.all([
        this.prisma.platformLedger.findMany({
          where: statusFilter,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.platformLedger.count({ where: statusFilter }),
      ]);
      return {
        entries: rows.map((x) => ({ ...x, ledgerKind: 'platform' as const })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    if (filters?.ledgerKind === 'advertiser') {
      const [rows, total] = await Promise.all([
        this.prisma.advertiserLedger.findMany({
          where: statusFilter,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.advertiserLedger.count({ where: statusFilter }),
      ]);
      return {
        entries: rows.map((x) => ({ ...x, ledgerKind: 'advertiser' as const })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    // Cross-ledger view: merge the top `skip + limit` rows from each table,
    // re-sort globally, then slice the requested page. Fetching `skip + limit`
    // (not just `limit`) keeps pagination correct beyond page 1, and the total
    // is the sum of per-table counts so totalPages is accurate.
    const take = skip + limit;
    const [e, a, p, ce, ca, cp] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where: statusFilter,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.advertiserLedger.findMany({
        where: statusFilter,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.platformLedger.findMany({
        where: statusFilter,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.earningsLedger.count({ where: statusFilter }),
      this.prisma.advertiserLedger.count({ where: statusFilter }),
      this.prisma.platformLedger.count({ where: statusFilter }),
    ]);
    const total = ce + ca + cp;
    const entries = [
      ...e.map((x) => ({ ...x, ledgerKind: 'earnings' as const })),
      ...a.map((x) => ({ ...x, ledgerKind: 'advertiser' as const })),
      ...p.map((x) => ({ ...x, ledgerKind: 'platform' as const })),
    ]
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .slice(skip, skip + limit);

    return { entries, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Platform-wide breakdown for admin dashboard */
  async getPlatformBreakdown() {
    const [
      totalEarnings,
      totalAdvertiserDebit,
      totalAdvertiserRefund,
      totalPlatformCredit,
      totalPlatformReversal,
      totalReserveCredit,
      totalReserveReversal,
      totalEarningsDebit,
      pendingEarnings,
    ] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: { in: ['confirmed', 'paid'] } },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit' },
      }),
      this.prisma.advertiserLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'refund' },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.PLATFORM_FEE },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'reversal', bucket: PLATFORM_BUCKETS.PLATFORM_FEE },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE },
      }),
      this.prisma.platformLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'reversal', bucket: PLATFORM_BUCKETS.FRAUD_RESERVE },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'debit' },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        _sum: { amountMinor: true },
        where: { entryType: 'credit', status: 'pending' },
      }),
    ]);

    const earningsByCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(earningsByCurrency, totalEarnings);
    this.addGroupedCurrencyTotals(earningsByCurrency, totalEarningsDebit, -1);

    // Advertiser spend = gross debits (billed) minus refunds (reversed fraud, archive)
    const advertiserByCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(advertiserByCurrency, totalAdvertiserDebit);
    this.addGroupedCurrencyTotals(advertiserByCurrency, totalAdvertiserRefund, -1);

    // Platform fees = gross credits (billed) minus reversals (reversed fraud)
    const platformByCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(platformByCurrency, totalPlatformCredit);
    this.addGroupedCurrencyTotals(platformByCurrency, totalPlatformReversal, -1);

    // Fraud reserve = gross credits minus reversals (released on false-positive)
    const reserveByCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(reserveByCurrency, totalReserveCredit);
    this.addGroupedCurrencyTotals(reserveByCurrency, totalReserveReversal, -1);

    const pendingByCurrency: Record<string, number> = {};
    this.addGroupedCurrencyTotals(pendingByCurrency, pendingEarnings);

    const earningsMinor = earningsByCurrency.USD ?? 0;
    const pendingMinor = pendingByCurrency.USD ?? 0;
    const advertiserMinor = advertiserByCurrency.USD ?? 0;
    const platformMinor = platformByCurrency.USD ?? 0;
    const reserveMinor = reserveByCurrency.USD ?? 0;

    return {
      totalEarnings: earningsMinor,
      totalAdvertiserSpend: advertiserMinor,
      totalPlatformFee: platformMinor,
      totalReserve: reserveMinor,
      byCurrency: {
        totalEarnings: earningsByCurrency,
        totalAdvertiserSpend: advertiserByCurrency,
        totalPlatformFee: platformByCurrency,
        totalReserve: reserveByCurrency,
      },
      // Nested structures for frontend page UI compatibility
      earningsLedger: {
        balanceMinor: earningsMinor,
        pendingMinor,
        confirmedMinor: earningsMinor,
        byCurrency: earningsByCurrency,
        pendingByCurrency,
      },
      advertiserLedger: {
        balanceMinor: advertiserMinor,
        byCurrency: advertiserByCurrency,
      },
      platformLedger: {
        revenueMinor: platformMinor,
        reserveMinor: reserveMinor,
        revenueByCurrency: platformByCurrency,
        reserveByCurrency,
      },
    };
  }
}
