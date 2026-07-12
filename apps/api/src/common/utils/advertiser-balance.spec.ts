import { describe, expect, it, vi } from 'vitest';

import { getAdvertiserBalance, getAdvertiserBalancesByCurrency } from './advertiser-balance';

interface Row {
  advertiserId: string;
  currency: string;
  entryType: string;
  amountMinor: bigint;
  status: string;
}

function fakeLedger(rows: Row[]) {
  return {
    advertiserLedger: {
      groupBy: vi.fn().mockImplementation((args: any) => {
        const where = args.where || {};
        const filtered = rows.filter((r) => {
          if (where.advertiserId) {
            const ids = Array.isArray(where.advertiserId)
              ? where.advertiserId
              : (where.advertiserId.in ?? [where.advertiserId]);
            if (!ids.includes(r.advertiserId)) return false;
          }
          if (where.currency && r.currency !== where.currency) return false;
          if (where.status && r.status !== where.status) return false;
          if (where.entryType?.in && !where.entryType.in.includes(r.entryType)) return false;
          return true;
        });
        return filtered.map((r) => ({
          advertiserId: r.advertiserId,
          currency: r.currency,
          entryType: r.entryType,
          _sum: { amountMinor: r.amountMinor },
        }));
      }),
    },
  } as any;
}

describe('getAdvertiserBalance (A-054, A-039)', () => {
  it('excludes a PENDING archive refund from spendable balance', async () => {
    const client = fakeLedger([
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'credit',
        amountMinor: 1000n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'debit',
        amountMinor: 300n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'refund',
        amountMinor: 200n,
        status: 'pending',
      },
    ]);
    const pending = await getAdvertiserBalance(client, 'a1', 'USD');
    expect(pending).toBe(700n);
  });

  it('a CONFIRMED archive refund reduces spendable balance (A-054)', async () => {
    const client = fakeLedger([
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'credit',
        amountMinor: 1000n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'debit',
        amountMinor: 300n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'refund',
        amountMinor: 200n,
        status: 'confirmed',
      },
    ]);
    const confirmed = await getAdvertiserBalance(client, 'a1', 'USD');
    expect(confirmed).toBe(500n);
  });

  it('filters by currency (A-039)', async () => {
    const client = fakeLedger([
      {
        advertiserId: 'a1',
        currency: 'EUR',
        entryType: 'credit',
        amountMinor: 900n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'credit',
        amountMinor: 100n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'debit',
        amountMinor: 100n,
        status: 'confirmed',
      },
    ]);
    const usd = await getAdvertiserBalance(client, 'a1', 'USD');
    expect(usd).toBe(0n);
    const eur = await getAdvertiserBalance(client, 'a1', 'EUR');
    expect(eur).toBe(900n);
  });
});

describe('getAdvertiserBalancesByCurrency (A-039)', () => {
  it('builds a per-(advertiser,currency) balance map', async () => {
    const client = fakeLedger([
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'credit',
        amountMinor: 1000n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'USD',
        entryType: 'debit',
        amountMinor: 400n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a1',
        currency: 'EUR',
        entryType: 'credit',
        amountMinor: 500n,
        status: 'confirmed',
      },
      {
        advertiserId: 'a2',
        currency: 'USD',
        entryType: 'credit',
        amountMinor: 50n,
        status: 'confirmed',
      },
    ]);

    const map = await getAdvertiserBalancesByCurrency(client, ['a1', 'a2']);
    expect(map.get('a1:USD')).toBe(600n);
    expect(map.get('a1:EUR')).toBe(500n);
    expect(map.get('a2:USD')).toBe(50n);
    // A USD campaign for a1 must see only the USD balance, not the EUR one.
    expect(map.get('a1:USD')).not.toBe(1100n);
  });
});
