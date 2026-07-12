import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '@waitlayer/db';
import { PAYOUT, primaryCurrency } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import {
  AVAILABLE_ENTRIES_DEFAULT_LIMIT,
  AVAILABLE_ENTRIES_MAX_LIMIT,
  boundedPositiveInt,
  RESERVED_PAYOUT_STATUSES,
} from './payout.constants';
import { PayoutMethodTrait } from './payout-method.trait';
import { PayoutRequestTrait } from './payout-request.trait';

export class PayoutSummaryTrait {
  declare prisma: PrismaService;
  declare config: ConfigService;
  declare logger: Logger;

  availableCurrencyTotals(totals: Record<string, bigint>): Record<string, bigint> {
    return Object.fromEntries(
      Object.entries(totals).map(([currency, amountMinor]) => [
        currency,
        amountMinor > 0n ? amountMinor : 0n,
      ]),
    );
  }

  /** Get payout info for a user */
  async getPayoutInfo(userId: string) {
    // Each sub-query is isolated so a single transient DB failure (e.g. one
    // overloaded index or a dead connection mid-batch) doesn't 500 the whole
    // response. A failed query yields an empty/default result for that slice
    // and is logged; the remaining slices still render.
    const safe = async <T>(fn: () => Promise<T>, label: string, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err: unknown) {
        this.logger.warn(
          `getPayoutInfo: sub-query "${label}" failed: ${err instanceof Error ? err.message : err}`,
        );
        return fallback;
      }
    };
    const [
      accounts,
      payoutHistory,
      confirmedEarnings,
      confirmedDebits,
      allocatedRows,
      userSecurity,
    ] = await Promise.all([
      safe(
        () =>
          this.prisma.payoutAccount.findMany({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'desc' },
          }),
        'accounts',
        [],
      ),
      safe(
        () =>
          this.prisma.payoutRequest.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { allocations: true },
          }),
        'payoutHistory',
        [],
      ),
      safe(
        () =>
          this.prisma.earningsLedger.groupBy({
            by: ['currency'],
            where: { userId, status: 'confirmed', entryType: 'credit' },
            _sum: { amountMinor: true },
          }),
        'confirmedEarnings',
        [],
      ),
      safe(
        () =>
          this.prisma.earningsLedger.groupBy({
            by: ['currency'],
            where: { userId, status: 'confirmed', entryType: 'debit' },
            _sum: { amountMinor: true },
          }),
        'confirmedDebits',
        [],
      ),
      // NOTE: this slice is intentionally NOT wrapped in `safe(...)`.
      // A transient failure here must THROW (rejecting the whole
      // `Promise.all`, surfacing as a 500) rather than falling back to a
      // value. Any silent fallback — `[]` OR `null` — would skip
      // subtracting in-flight payouts and OVERstate the available balance
      // (the only unsafe direction among the resilient fallbacks). Better a
      // 500 than a lie. The authoritative `requestPayout` re-validates
      // availability anyway.
      this.prisma.$queryRaw<
        Array<{
          currency: string;
          amountMinor: bigint | number | null;
        }>
      >`
        SELECT e."currency" AS "currency", COALESCE(SUM(pa."amountMinor"), 0)::bigint AS "amountMinor"
        FROM "payout_allocations" pa
        INNER JOIN "payout_requests" pr ON pr."id" = pa."payoutRequestId"
        INNER JOIN "earnings_ledger" e ON e."id" = pa."earningsEntryId"
        WHERE pr."userId" = ${userId}
          AND pr."status" IN (${Prisma.join(RESERVED_PAYOUT_STATUSES)})
        GROUP BY e."currency"
      `,
      safe(
        () =>
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorEnabled: true },
          }),
        'userSecurity',
        null,
      ),
    ]);
    const rawBalancesByCurrency: Record<string, bigint> = {};
    for (const row of confirmedEarnings) {
      this.addCurrencyAmount(rawBalancesByCurrency, row.currency, row._sum.amountMinor ?? 0n);
    }
    for (const row of confirmedDebits) {
      this.addCurrencyAmount(rawBalancesByCurrency, row.currency, -(row._sum.amountMinor ?? 0n));
    }
    if (allocatedRows) {
      for (const row of allocatedRows) {
        this.addCurrencyAmount(
          rawBalancesByCurrency,
          row.currency,
          -(row.amountMinor !== null && row.amountMinor !== undefined
            ? BigInt(row.amountMinor)
            : 0n),
        );
      }
    }
    const availableBalanceByCurrency = this.availableCurrencyTotals(rawBalancesByCurrency);
    // Derive the primary currency from the user's ACTUAL earnings
    // balance (largest positive), not from an arbitrary payout account
    // (`accounts[0]`). Fixes the multi-currency bug where a
    // developer with EUR earnings but a USD-first account saw a
    // misleading `currency: 'USD'` / `$0` balance.
    const currency = primaryCurrency(availableBalanceByCurrency);
    return {
      payoutAccounts: accounts,
      availableBalanceMinor: availableBalanceByCurrency[currency] ?? 0n,
      availableBalanceByCurrency,
      minimumThresholdMinor: BigInt(PAYOUT.MINIMUM_THRESHOLD_MINOR),
      currency,
      payoutHistory,
      requiresTwoFactorForPayout: this.config.get<string>('PAYOUT_REQUIRE_2FA') === 'true',
      twoFactorEnabled: userSecurity?.twoFactorEnabled ?? false,
    };
  }

  /** Get confirmed earnings available for payout (not already allocated to another payout request) */
  async getAvailableForPayout(
    userId: string,
    params: {
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = boundedPositiveInt(params.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = boundedPositiveInt(
      params.limit,
      AVAILABLE_ENTRIES_DEFAULT_LIMIT,
      AVAILABLE_ENTRIES_MAX_LIMIT,
    );
    const unallocatedCreditWhere: Prisma.EarningsLedgerWhereInput = {
      userId,
      status: 'confirmed',
      entryType: 'credit',
      payoutAllocations: {
        none: {
          payoutRequest: {
            userId,
            status: { in: RESERVED_PAYOUT_STATUSES },
          },
        },
      },
    };
    const [availableCredits, confirmedDebits, entryRows, totalEntries] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: unallocatedCreditWhere,
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.findMany({
        where: unallocatedCreditWhere,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit + 1,
      }),
      this.prisma.earningsLedger.count({ where: unallocatedCreditWhere }),
    ]);
    const available = entryRows.slice(0, limit);
    const totalsByCurrency: Record<string, bigint> = {};
    for (const row of availableCredits) {
      this.addCurrencyAmount(totalsByCurrency, row.currency, row._sum.amountMinor ?? 0n);
    }
    for (const row of confirmedDebits) {
      this.addCurrencyAmount(totalsByCurrency, row.currency, -(row._sum.amountMinor ?? 0n));
    }
    const availableByCurrency = this.availableCurrencyTotals(totalsByCurrency);
    // Derive the primary currency from the user's ACTUAL available
    // earnings (largest positive), not a hardcoded 'USD'. Fixes the
    // multi-currency bug where a developer with only EUR earnings
    // saw `totalMinor: 0, currency: 'USD'`.
    const currency = primaryCurrency(availableByCurrency);
    return {
      entries: available,
      totalMinor: availableByCurrency[currency] ?? 0n,
      currency,
      count: totalEntries,
      page,
      limit,
      hasMore: entryRows.length > limit,
      totalsByCurrency: availableByCurrency,
    };
  }

  /** Get payout history for a user */
  async getPayoutHistory(userId: string, page = 1, limit = 20) {
    const [payouts, total] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where: { userId },
        include: { payoutAccount: true, transactions: true, allocations: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payoutRequest.count({ where: { userId } }),
    ]);
    return { payouts, total, page, limit };
  }
}
export interface PayoutSummaryTrait extends PayoutRequestTrait, PayoutMethodTrait {}
