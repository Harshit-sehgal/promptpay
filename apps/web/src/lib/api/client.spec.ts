import { describe, expect, it } from 'vitest';

import { coerceBigInts, serializeBigInts } from './client';

describe('web API bigint boundary', () => {
  it('serializes nested request bigints as exact decimal strings', () => {
    expect(
      serializeBigInts({
        amountMinor: 9_007_199_254_740_993n,
        nested: [{ budgetTotalMinor: 5_000n }],
      }),
    ).toEqual({
      amountMinor: '9007199254740993',
      nested: [{ budgetTotalMinor: '5000' }],
    });
  });

  it('restores monetary response fields without coercing ids and counts', () => {
    expect(
      coerceBigInts({
        amountMinor: '9007199254740993',
        totalSpendByCurrency: { USD: '100', JPY: '2500' },
        providerTxId: '123',
        estimatedEarnings: '42',
        ledgerDebits: '7',
        impressions: 123,
      }),
    ).toEqual({
      amountMinor: 9_007_199_254_740_993n,
      totalSpendByCurrency: { USD: 100n, JPY: 2500n },
      providerTxId: '123',
      estimatedEarnings: 42n,
      ledgerDebits: 7n,
      impressions: 123,
    });
  });
});
