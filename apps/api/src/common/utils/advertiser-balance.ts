import type { PrismaService } from '../../config/prisma.service';

type BalanceClient = Pick<PrismaService, 'advertiserLedger'>;

/**
 * Centralized advertiser spendable-balance formula — the single source of
 * truth referenced by campaign activation, ad serving, resume, and billing
 * (issues A-054 / A-039 / A-055).
 *
 *   spendable = confirmed credits + confirmed reversals − confirmed debits
 *               − pending/confirmed refunds
 *
 * Notes:
 *  - `refund` rows are archive-refund obligations (entryType = 'refund'). They
 *    are created with `status: 'pending'` (cash has not yet left the platform)
 *    and only reduce the spendable balance once an admin confirms the Stripe
 *    refund (`status: 'confirmed'`). See A-054.
 *  - Dispute holds / reversals live on row `status` ('held' / 'reversed'),
 *    not on entryType, so the `status: 'confirmed'` filter already excludes
 *    them from spendable balance.
 *  - `held` advertiser credit (open dispute) is likewise excluded by the
 *    `status: 'confirmed'` filter.
 */
export async function getAdvertiserBalance(
  client: BalanceClient,
  advertiserId: string,
  currency: string,
): Promise<bigint> {
  const rows = await client.advertiserLedger.groupBy({
    by: ['entryType', 'status'],
    where: {
      advertiserId,
      currency,
      status: { in: ['pending', 'confirmed'] },
      entryType: { in: ['credit', 'debit', 'refund', 'reversal'] },
    },
    _sum: { amountMinor: true },
  });

  let credits = 0n;
  let debits = 0n;
  let refunds = 0n;
  let reversals = 0n;
  for (const row of rows) {
    const amount = BigInt(row._sum.amountMinor ?? 0);
    if (row.entryType === 'refund') refunds += amount;
    else if (row.status !== 'confirmed') continue;
    else if (row.entryType === 'credit') credits += amount;
    else if (row.entryType === 'debit') debits += amount;
    else if (row.entryType === 'reversal') reversals += amount;
  }
  return credits + reversals - debits - refunds;
}

/**
 * Build a per-(advertiserId, currency) spendable balance map in a single
 * grouped query. Used by ad serving to filter each campaign against its own
 * currency balance (issue A-039) instead of an all-currency aggregate.
 */
export async function getAdvertiserBalancesByCurrency(
  client: BalanceClient,
  advertiserIds: string[],
): Promise<Map<string, bigint>> {
  const rows = await client.advertiserLedger.groupBy({
    by: ['advertiserId', 'currency', 'entryType', 'status'],
    where: {
      advertiserId: { in: advertiserIds },
      status: { in: ['pending', 'confirmed'] },
      entryType: { in: ['credit', 'debit', 'refund', 'reversal'] },
    },
    _sum: { amountMinor: true },
  });

  const map = new Map<string, bigint>();
  for (const row of rows) {
    const key = `${row.advertiserId}:${row.currency}`;
    const current = map.get(key) ?? 0n;
    const amount = BigInt(row._sum.amountMinor ?? 0);
    if (row.entryType === 'refund') map.set(key, current - amount);
    else if (row.status !== 'confirmed') continue;
    else if (row.entryType === 'credit' || row.entryType === 'reversal') {
      map.set(key, current + amount);
    } else if (row.entryType === 'debit') {
      map.set(key, current - amount);
    }
  }
  return map;
}
