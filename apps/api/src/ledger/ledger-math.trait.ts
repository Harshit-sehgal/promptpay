import { BadRequestException } from '@nestjs/common';

import { PAYOUT_HOLD_DAYS } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';

export class LedgerMathTrait {
  declare prisma: PrismaService;

  addCurrencyAmount(
    totals: Record<string, bigint>,
    currency: string | null | undefined,
    amountMinor: bigint,
  ) {
    const key = (currency || 'USD').toUpperCase();
    totals[key] = (totals[key] ?? 0n) + amountMinor;
  }

  addGroupedCurrencyTotals(
    totals: Record<string, bigint>,
    rows: Array<{
      currency: string;
      _sum: {
        amountMinor: bigint | null;
      };
    }>,
    multiplier = 1n,
  ) {
    for (const row of rows) {
      this.addCurrencyAmount(totals, row.currency, (row._sum.amountMinor ?? 0n) * multiplier);
    }
  }

  nonNegativeCurrencyTotals(totals: Record<string, bigint>): Record<string, bigint> {
    return Object.fromEntries(
      Object.entries(totals).map(([currency, amountMinor]) => [
        currency,
        amountMinor > 0n ? amountMinor : 0n,
      ]),
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
  calculateSplit(bidAmountMinor: bigint, useLaunchIncentive = false) {
    // Guard: a non-positive bid would silently produce zero/negative platform
    // and reserve shares — a money-accounting bug. Refuse outright so callers
    // fail closed instead of writing a bogus split.
    if (typeof bidAmountMinor !== 'bigint' || bidAmountMinor <= 0n) {
      throw new BadRequestException(
        `calculateSplit requires a positive bid amount (got ${bidAmountMinor})`,
      );
    }
    // Split percentages expressed as basis points (1 bps = 0.01%). Sum to 10000
    // (100.00%) for both REVENUE_SPLIT and LAUNCH_INCENTIVE_SPLIT at the source —
    // no float round-trip through the constants.
    const USER_BPS = 6000n;
    const PLATFORM_BPS = 3000n;
    const RESERVE_BPS = 1000n;
    const LAUNCH_USER_BPS = 8000n;
    const LAUNCH_PLATFORM_BPS = 1000n;
    const LAUNCH_RESERVE_BPS = 1000n;
    const userBps = useLaunchIncentive ? LAUNCH_USER_BPS : USER_BPS;
    const platformBps = useLaunchIncentive ? LAUNCH_PLATFORM_BPS : PLATFORM_BPS;
    const reserveBps = useLaunchIncentive ? LAUNCH_RESERVE_BPS : RESERVE_BPS;
    // Integer partition: largest-share-first convention absorbs any rounding
    // remainder deterministically. BigInt division truncates toward zero, which
    // is equivalent to floor() for positive values.
    const userShare = (bidAmountMinor * userBps) / 10000n;
    const platformShare = (bidAmountMinor * platformBps) / 10000n;
    const reserveShare = (bidAmountMinor * reserveBps) / 10000n;
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
}
