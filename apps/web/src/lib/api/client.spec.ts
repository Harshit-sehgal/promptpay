import { describe, expect, it } from 'vitest';

import api, { coerceBigInts, serializeBigInts, stringifyApiData } from './client';

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

  it('recurses through object-valued currency maps', () => {
    expect(
      coerceBigInts({
        globalReconciliationByCurrency: {
          USD: {
            discrepancyMinor: '0',
            netAdvertiserSpendMinor: '9007199254740993',
            currency: 'USD',
          },
        },
      }),
    ).toEqual({
      globalReconciliationByCurrency: {
        USD: {
          discrepancyMinor: 0n,
          netAdvertiserSpendMinor: 9_007_199_254_740_993n,
          currency: 'USD',
        },
      },
    });
  });

  it('applies exact bigint serialization before Axios sends a request body', async () => {
    let wireBody: unknown;

    await api.post(
      '/bigint-boundary-test',
      { amountMinor: 9_007_199_254_740_993n },
      {
        adapter: async (config) => {
          wireBody = config.data;
          return {
            config,
            data: {},
            headers: {},
            status: 200,
            statusText: 'OK',
          };
        },
      },
    );

    expect(JSON.parse(String(wireBody))).toEqual({ amountMinor: '9007199254740993' });
  });

  it('serializes downloaded export rows containing bigint money fields', () => {
    const exportJson = stringifyApiData({ earnings: [{ amountMinor: 9_007_199_254_740_993n }] }, 2);

    expect(JSON.parse(exportJson)).toEqual({
      earnings: [{ amountMinor: '9007199254740993' }],
    });
  });
});
