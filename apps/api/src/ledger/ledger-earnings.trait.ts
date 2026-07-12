import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { LedgerStatus } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { EARNING_TRANSITIONS, PLATFORM_BUCKETS } from './ledger.constants';
import { LedgerMathTrait } from './ledger-math.trait';

export class LedgerEarningsTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;

  // ── Recording Earnings ──
  /** Record impression earnings across all three ledgers atomically */
  async recordImpressionEarnings(params: {
    userId: string;
    campaignId: string;
    impressionId: string;
    bidAmountMinor: bigint;
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
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1::bigint WHERE "id" = $2 AND "budgetSpentMinor" + $1::bigint <= "budgetTotalMinor" AND "status" = 'active'`,
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
    clickBidMinor: bigint;
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
        `UPDATE "campaigns" SET "budgetSpentMinor" = "budgetSpentMinor" + $1::bigint WHERE "id" = $2 AND "budgetSpentMinor" + $1::bigint <= "budgetTotalMinor" AND "status" = 'active'`,
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
  async releaseEarnings(
    userId: string,
    opts?: {
      impressionId?: string;
      flagId?: string;
    },
  ) {
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
      return { count: 0 } satisfies {
        count: number;
      };
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
    ref: {
      impressionId?: string;
      clickId?: string;
    },
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
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
    // Audit: reverseEarnings is the highest-stakes fraud-mutation path — it
    // reflows money across four ledgers (developer earnings flip, advertiser
    // refund, platform-fee reversal, fraud-reserve release) and writes
    // idempotent recovery-debt rows for already-paid entries. It is callable
    // only from the service layer (fraud-flag resolution + reportAd
    // invalidation), so the controller-layer AuditInterceptor cannot see it.
    // Emit a system-actor audit row here so the triggering decision is always
    // visible in the audit timeline alongside the immutable ledger rows it
    // produced. `actorRole: 'system'` mirrors the stripe-webhook convention;
    // callers that want a richer actor (e.g. the resolving admin) can be
    // threaded through a future opts.actorId once the call sites carry one.
    void this.audit.log({
      actorId: 'ledger_service',
      actorRole: 'system',
      action: 'reverse_earnings',
      targetType: entityCol === 'clickId' ? 'click' : 'impression',
      targetId: entityId,
      beforeSnap: {
        reversed: result.reversed,
        paidSkipped: result.paidSkipped,
        reason: reason ?? null,
      },
    });
    return result;
  }
}
export interface LedgerEarningsTrait extends LedgerMathTrait {}
