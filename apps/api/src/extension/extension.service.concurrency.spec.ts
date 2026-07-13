import { describe, expect, it, vi } from 'vitest';

import { ExtensionService } from './extension.service';

/**
 * A-055 — Concurrent billable events cannot overdraw the advertiser balance.
 *
 * recordQualifiedImpression() (and recordClick()) open a transaction, obtain a
 * `pg_advisory_xact_lock` keyed by (advertiserId, currency), and re-check the
 * spendable balance *inside* the locked transaction before debiting the
 * advertiser. The lock serializes same-advertiser+currency billing writes on a
 * real Postgres so two concurrent campaigns cannot both read the same pre-bill
 * balance and overdraw the account.
 *
 * True concurrency requires a real Postgres (the advisory lock only exists
 * there). This spec instead proves the *intended invariant* at the unit level:
 * it drives the in-transaction balance re-check through a mocked
 * `prisma.$transaction` callback backed by a shared in-memory ledger store. The
 * mock `$transaction` runs each callback to completion (writes committed to the
 * store) before the next call begins — exactly the serialized execution the
 * advisory lock guarantees. So:
 *
 *   - GIVEN an advertiser balance equal to exactly ONE bid (100 minor units),
 *   - WHEN two billable impressions on TWO different campaigns are qualified
 *     "concurrently" (serialized through the locked transaction),
 *   - THEN exactly ONE is billed and the other is rejected with
 *     `insufficient_advertiser_balance`; the balance never goes negative.
 *
 * The final, authoritative proof is a DB-backed integration test (real advisory
 * lock); this spec locks the re-check logic so a regression there fails fast.
 */

// In-memory ledger store shared by the outer prisma mock and the tx mock, so a
// debit written inside one transaction is visible to the balance re-check of a
// later transaction.
interface LedgerRow {
  advertiserId: string;
  currency: string;
  entryType: string;
  status: string;
  amountMinor: bigint;
  idempotencyKey?: string;
}

function groupAdvertiserLedger(
  store: LedgerRow[],
  where: { advertiserId: string; currency: string; status: string; entryType: { in: string[] } },
) {
  const rows = store.filter(
    (r) =>
      r.advertiserId === where.advertiserId &&
      r.currency === where.currency &&
      r.status === where.status &&
      where.entryType.in.includes(r.entryType),
  );
  const byType: Record<string, number> = {};
  for (const r of rows) {
    byType[r.entryType] = (byType[r.entryType] ?? 0n) + r.amountMinor;
  }
  return (['credit', 'debit', 'refund'] as const).map((entryType) => ({
    entryType,
    _sum: { amountMinor: byType[entryType] ?? 0n },
  }));
}

function makePrisma() {
  const store: LedgerRow[] = [
    // One confirmed credit of 100 = exactly ONE bid's worth of balance.
    {
      advertiserId: 'adv-1',
      currency: 'USD',
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: 100n,
    },
  ];

  const advertiserLedger = {
    groupBy: vi.fn(async (args: any) => groupAdvertiserLedger(store, args.where)),
    create: vi.fn(async (args: { data: LedgerRow }) => {
      store.push(args.data);
      return args.data;
    }),
  };

  const prisma: any = {
    store,
    advertiserLedger,
    earningsLedger: { create: vi.fn(async (args: any) => args.data) },
    platformLedger: { create: vi.fn(async (args: any) => args.data) },
    trustScore: { findUnique: vi.fn().mockResolvedValue(null) },
    adImpression: {
      findUnique: vi.fn(),
      update: vi.fn(async (args: any) => args.data),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };

  // Serialize transaction callbacks through a promise chain so concurrent
  // callers run strictly one-at-a-time — this SIMULATES the real
  // `pg_advisory_xact_lock(advertiser+currency)` that the production code
  // acquires before the in-transaction balance re-check. With this mutex, the
  // first callback's debit is committed to the shared store before the second
  // callback's balance re-check reads it, exactly as the advisory lock
  // guarantees on Postgres. (The authoritative proof is the DB integration
  // test; this mutex makes the unit test deterministic and meaningful.)
  let txChain: Promise<unknown> = Promise.resolve();
  prisma.$transaction = vi.fn(async (cb: (tx: any) => Promise<any>) => {
    const tx = {
      advertiserLedger,
      earningsLedger: prisma.earningsLedger,
      platformLedger: prisma.platformLedger,
      adImpression: { updateMany: prisma.adImpression.updateMany },
      // Tagged-template form used by the advisory lock (pg_advisory_xact_lock).
      $executeRaw: vi.fn(async () => 1),
      $executeRawUnsafe: vi.fn(async () => 1),
    };
    const run = txChain.then(() => cb(tx));
    txChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });
  prisma.$executeRawUnsafe = vi.fn(async () => 1);

  return prisma;
}

function makeImpression(token: string, campaignId: string, bidAmountMinor = 100) {
  return {
    id: `imp-${campaignId}`,
    userId: 'user-1',
    deviceId: 'dev-1',
    impressionTokenHash: `hash-${token}`,
    renderedAt: new Date(Date.now() - 10_000), // beyond MINIMUM_VISIBLE_DURATION_MS
    qualifiedAt: null,
    campaign: {
      id: campaignId,
      bidAmountMinor,
      currency: 'USD',
      advertiserId: 'adv-1',
      bidType: 'cpm',
    },
    user: { status: 'active' },
  };
}

describe('concurrent billable impressions cannot overdraw advertiser balance (A-055)', () => {
  it('persists server-authoritative qualification time and clamps reported duration', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-13T12:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const prisma = makePrisma();
      const service = new ExtensionService(
        prisma,
        { log: vi.fn().mockResolvedValue(undefined) } as any,
        {
          calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
          getHoldDays: vi.fn(() => 7),
        } as any,
        { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
        {} as any,
        {} as any,
      );
      (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
      prisma.adImpression.findUnique.mockResolvedValue(makeImpression('tok-1', 'camp-1'));

      await service.recordQualifiedImpression('user-1', {
        impressionToken: 'tok-1',
        qualifiedAt: '2035-01-01T00:00:00.000Z',
        visibleDurationMs: 500_000,
        idempotencyKey: 'idem-tok-1',
        signature: 'sig',
      });

      const qualificationWrite = prisma.adImpression.updateMany.mock.calls[0][0].data;
      expect(qualificationWrite.qualifiedAt).toEqual(now);
      expect(qualificationWrite.visibleDurationMs).toBe(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bills exactly one of two concurrent one-bid-balance impressions and rejects the other', async () => {
    const prisma = makePrisma();
    const audit = { log: vi.fn().mockResolvedValue(undefined) } as any;
    const ledger = {
      calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
      getHoldDays: vi.fn(() => 7),
    } as any;
    const fraud = {
      checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    } as any;
    const compliance = {} as any;
    const googleVerifier = {} as any;

    const service = new ExtensionService(prisma, audit, ledger, fraud, compliance, googleVerifier);
    // Skip HMAC device-signature verification — out of scope for this test.
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);

    // Two distinct impressions on two different campaigns, same advertiser+USD.
    const impression1 = makeImpression('tok-1', 'camp-1');
    const impression2 = makeImpression('tok-2', 'camp-2');
    prisma.adImpression.findUnique
      .mockResolvedValueOnce(impression1)
      .mockResolvedValueOnce(impression2);

    const dto = (token: string) => ({
      impressionToken: token,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: `idem-${token}`,
      signature: 'sig',
    });

    const [res1, res2] = await Promise.all([
      service.recordQualifiedImpression('user-1', dto('tok-1')),
      service.recordQualifiedImpression('user-1', dto('tok-2')),
    ]);

    const billed = [res1, res2].filter((r) => r.qualified === true);
    const rejected = [res1, res2].filter(
      (r) => r.qualified === false && r.reason === 'insufficient_advertiser_balance',
    );

    expect(billed.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Exactly one confirmed debit was written; balance never went negative.
    const debits = prisma.store.filter(
      (r: LedgerRow) => r.entryType === 'debit' && r.status === 'confirmed',
    );
    expect(debits.length).toBe(1);
    expect(debits[0].amountMinor).toBe(100n);

    // Final spendable balance must be exactly 0 (never negative).
    const finalBalance = prisma.store
      .filter((r: LedgerRow) => r.status === 'confirmed')
      .reduce(
        (acc: bigint, r: LedgerRow) =>
          acc + (r.entryType === 'credit' ? r.amountMinor : -r.amountMinor),
        0n,
      );
    expect(finalBalance).toBe(0n);
  });

  it('rejects the second impression even when run strictly sequentially (serialized lock semantics)', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);

    const impression1 = makeImpression('tok-1', 'camp-1');
    const impression2 = makeImpression('tok-2', 'camp-2');
    prisma.adImpression.findUnique
      .mockResolvedValueOnce(impression1)
      .mockResolvedValueOnce(impression2);

    const dto = (token: string) => ({
      impressionToken: token,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: `idem-${token}`,
      signature: 'sig',
    });

    const res1 = await service.recordQualifiedImpression('user-1', dto('tok-1'));
    const res2 = await service.recordQualifiedImpression('user-1', dto('tok-2'));

    expect(res1.qualified).toBe(true);
    expect(res2.qualified).toBe(false);
    expect(res2.reason).toBe('insufficient_advertiser_balance');
  });
});
