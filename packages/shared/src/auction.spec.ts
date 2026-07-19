import { describe, expect, it } from 'vitest';

import {
  groupCampaignsByCurrency,
  nextBillableCharge,
  randomBigIntBelow,
  selectCampaignIndex,
} from './auction';

describe('nextBillableCharge', () => {
  it('returns the per-event bid for CPM/CPC (the next possible charge)', () => {
    expect(nextBillableCharge(100n)).toBe(100n);
  });
  it('clamps a negative bid to zero', () => {
    expect(nextBillableCharge(-5n)).toBe(0n);
  });
});

describe('groupCampaignsByCurrency', () => {
  it('groups by currency with deterministic ascending code order', () => {
    const out = groupCampaignsByCurrency([
      { id: 'a', currency: 'USD', bidAmountMinor: 1n },
      { id: 'b', currency: 'JPY', bidAmountMinor: 2n },
      { id: 'c', currency: 'USD', bidAmountMinor: 3n },
      { id: 'd', currency: 'EUR', bidAmountMinor: 4n },
    ]);
    expect(out.map((g) => g.currency)).toEqual(['EUR', 'JPY', 'USD']);
    expect(out.find((g) => g.currency === 'USD')!.indices).toEqual([0, 2]);
  });
});

describe('randomBigIntBelow', () => {
  it('returns a value in [0, maxExclusive)', () => {
    for (let i = 0; i < 500; i++) {
      const v = randomBigIntBelow(1_000_000_000_000n);
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(1_000_000_000_000n);
    }
  });
  it('returns 0n for non-positive max', () => {
    expect(randomBigIntBelow(0n)).toBe(0n);
    expect(randomBigIntBelow(-5n)).toBe(0n);
  });
  it('handles values above Number.MAX_SAFE_INTEGER exactly', () => {
    const max = 2n ** 60n;
    for (let i = 0; i < 50; i++) {
      const v = randomBigIntBelow(max);
      expect(v >= 0n && v < max).toBe(true);
    }
  });
  it('is uniform over small bounds (2, 3, 5, 7, 10)', () => {
    for (const bound of [2n, 3n, 5n, 7n, 10n]) {
      const counts = new Map<bigint, number>();
      const N = 10000;
      for (let i = 0; i < N; i++) {
        const v = randomBigIntBelow(bound);
        expect(v >= 0n && v < bound).toBe(true);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const expected = N / Number(bound);
      for (let b = 0n; b < bound; b++) {
        const c = counts.get(b) ?? 0;
        // Every bucket must be observed; the tolerance catches a gross skew
        // (e.g. a modulo-over-wrong-range regression) without flaking on
        // normal sampling noise. The fix masks to a power-of-two range so the
        // true distribution is exactly uniform.
        expect(c).toBeGreaterThan(0);
        expect(Math.abs(c - expected)).toBeLessThan(expected * 0.25);
      }
    }
  }, 20000);
});

describe('selectCampaignIndex — cross-currency safety', () => {
  it('returns -1 for an empty input', () => {
    expect(selectCampaignIndex([])).toBe(-1);
  });
  it('returns the only campaign index unchanged', () => {
    expect(selectCampaignIndex([{ id: 'x', currency: 'USD', bidAmountMinor: 5n }])).toBe(0);
  });

  it('does NOT treat 100 JPY minor as economically equal to 100 USD cents', () => {
    // Deterministic draw: pick group index 0 (EUR is alphabetically first
    // among EUR/JPY/USD → EUR first). JPY 100 and USD 100 must not tie in a
    // single raw-minor auction; the per-currency arbitration gives every
    // currency group an equal chance regardless of bid magnitude.
    const camps = [
      { id: 'usd', currency: 'USD', bidAmountMinor: 100n }, // $1.00
      { id: 'jpy', currency: 'JPY', bidAmountMinor: 100n }, // ¥100 (~$0.67)
      { id: 'eur', currency: 'EUR', bidAmountMinor: 1n }, // €0.01
    ];
    // Force group pick = 0 (EUR group, alphabetically first).
    let call = 0;
    const idx = selectCampaignIndex(camps, {
      randomBelow: () => {
        if (call === 0) {
          call++;
          return 0n; // group index 0
        }
        // within-group weighted draw: EUR has only one campaign.
        return 0n;
      },
    });
    expect(camps[idx].id).toBe('eur');
    // Even though USD and JPY both have raw minor 100, they never compete
    // because they're in different currency groups.
  });

  it('picks USD campaign when USD group is selected (weighted by bid within USD)', () => {
    const camps = [
      { id: 'usd-low', currency: 'USD', bidAmountMinor: 10n },
      { id: 'usd-high', currency: 'USD', bidAmountMinor: 90n },
      { id: 'eur', currency: 'EUR', bidAmountMinor: 1000n },
    ];
    // Groups sorted ascending: EUR (idx 0), USD (idx 1). Pick USD group.
    let call = 0;
    const idx = selectCampaignIndex(camps, {
      randomBelow: () => {
        if (call === 0) {
          call++;
          return 1n; // group index 1 = USD
        }
        // totalBid within USD = 100n. Draw 95n → usd-high wins (90n boundary).
        call++;
        return 95n;
      },
    });
    expect(camps[idx].id).toBe('usd-high');
  });

  it('uniformly falls back when every bid in the group is zero', () => {
    const camps = [
      { id: 'usd-a', currency: 'USD', bidAmountMinor: 0n },
      { id: 'usd-b', currency: 'USD', bidAmountMinor: 0n },
    ];
    let call = 0;
    const idx = selectCampaignIndex(camps, {
      randomBelow: () => {
        if (call === 0) {
          call++;
          return 0n; // pick group 0 (USD)
        }
        return 1n; // pick the second campaign in the group uniformly
      },
    });
    expect(camps[idx].id).toBe('usd-b');
  });

  it('is deterministic given identical random draws', () => {
    const camps = [
      { id: 'a', currency: 'USD', bidAmountMinor: 30n },
      { id: 'b', currency: 'USD', bidAmountMinor: 70n },
    ];
    const draws = [0n, 35n];
    let call = 0;
    const run = () =>
      selectCampaignIndex(camps, {
        randomBelow: () => {
          const v = draws[call++] ?? 0n;
          return v;
        },
      });
    expect(camps[run()].id).toBe('b');
    call = 0;
    expect(camps[run()].id).toBe('b');
  });

  it('never compares raw minor units across currencies for INR/USD/JPY/EUR mix', () => {
    // A large INR paise value (10_00_000 = ₹10,000 ~ $120) must NOT dominate
    // a small USD bid ($1) under the old raw-minor ordering. Each currency
    // gets an equal group-pick chance.
    const camps = [
      { id: 'inr', currency: 'INR', bidAmountMinor: 10_00_000n },
      { id: 'usd', currency: 'USD', bidAmountMinor: 100n },
      { id: 'jpy', currency: 'JPY', bidAmountMinor: 100n },
      { id: 'eur', currency: 'EUR', bidAmountMinor: 50n },
    ];
    // Pick group index 2 — groups sorted: EUR(0), INR(1), JPY(2), USD(3).
    let call = 0;
    const idx = selectCampaignIndex(camps, {
      randomBelow: () => {
        if (call === 0) {
          call++;
          return 2n; // JPY group
        }
        return 0n;
      },
    });
    expect(camps[idx].id).toBe('jpy');
  });
});

describe('selectCampaignIndex — inventory policy (P1.2)', () => {
  it('weights currency-group selection by eligible-campaign count (sparse currency no longer equal to dense)', () => {
    // 100 USD campaigns vs 1 JPY campaign. Under count-weighted selection the
    // single JPY campaign must win ~1/101 of the time (~1%), NOT ~50% as the
    // old group-uniform pick gave it — proving sparse-currency gaming is gone.
    const campaigns = [
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `usd-${i}`,
        currency: 'USD',
        bidAmountMinor: 10n,
      })),
      { id: 'jpy-1', currency: 'JPY', bidAmountMinor: 10n },
    ];
    let jpy = 0;
    let usd = 0;
    const N = 8000;
    for (let k = 0; k < N; k++) {
      const c = campaigns[selectCampaignIndex(campaigns)];
      if (c.currency === 'JPY') jpy++;
      else usd++;
    }
    const jpyRate = jpy / N;
    const usdRate = usd / N;
    // Sparse currency gets only its proportional (~1%) share — nowhere near
    // the 50% the old uniform pick allowed.
    expect(jpyRate).toBeLessThan(0.05);
    expect(jpyRate).toBeGreaterThan(0);
    expect(usdRate).toBeGreaterThan(0.9);
  });

  it('currency-group selection probability is proportional to eligible-campaign count', () => {
    // 3 USD campaigns vs 1 JPY campaign → USD group should win ~75% of the
    // time (3/4), confirming weighting is by campaign count, not uniform.
    const campaigns = [
      { id: 'usd-0', currency: 'USD', bidAmountMinor: 10n },
      { id: 'usd-1', currency: 'USD', bidAmountMinor: 10n },
      { id: 'usd-2', currency: 'USD', bidAmountMinor: 10n },
      { id: 'jpy-1', currency: 'JPY', bidAmountMinor: 10n },
    ];
    let usd = 0;
    const N = 8000;
    for (let k = 0; k < N; k++) {
      if (campaigns[selectCampaignIndex(campaigns)].currency === 'USD') usd++;
    }
    const rate = usd / N;
    expect(rate).toBeGreaterThan(0.65);
    expect(rate).toBeLessThan(0.85);
  });

  it('never lets a huge bid in one currency affect another currency selection', () => {
    const campaigns = [
      { id: 'usd', currency: 'USD', bidAmountMinor: 10n },
      { id: 'jpy', currency: 'JPY', bidAmountMinor: 1_000_000_000n },
    ];
    let usd = 0;
    const N = 4000;
    for (let k = 0; k < N; k++) {
      if (campaigns[selectCampaignIndex(campaigns)].currency === 'USD') usd++;
    }
    const rate = usd / N;
    expect(rate).toBeGreaterThan(0.43);
    expect(rate).toBeLessThan(0.57);
  });
});

describe('selectCampaignIndex — adversarial robustness (P1.3)', () => {
  it('a dominant within-currency bid wins proportionally', () => {
    const campaigns = [
      { id: 'low', currency: 'USD', bidAmountMinor: 10n },
      { id: 'high', currency: 'USD', bidAmountMinor: 1000n },
    ];
    let high = 0;
    const N = 4000;
    for (let k = 0; k < N; k++) {
      if (campaigns[selectCampaignIndex(campaigns)].id === 'high') high++;
    }
    expect(high / N).toBeGreaterThan(0.95);
  });

  it('clamps a malformed negative bid to zero weight (never skews others)', () => {
    const campaigns = [
      { id: 'neg', currency: 'USD', bidAmountMinor: -5n },
      { id: 'ok', currency: 'USD', bidAmountMinor: 10n },
    ];
    for (let k = 0; k < 200; k++) {
      expect(selectCampaignIndex(campaigns)).toBe(1);
    }
  });

  it('all-zero bids fall back to uniform, no campaign can force a win', () => {
    const campaigns = [
      { id: 'a', currency: 'USD', bidAmountMinor: 0n },
      { id: 'b', currency: 'USD', bidAmountMinor: 0n },
    ];
    const counts = [0, 0];
    for (let k = 0; k < 4000; k++) counts[selectCampaignIndex(campaigns)]++;
    expect(counts[0] / 4000).toBeGreaterThan(0.43);
    expect(counts[1] / 4000).toBeGreaterThan(0.43);
  });

  it('duplicate entries in the input receive proportional double weight (caller must dedupe)', () => {
    // The auction weights by array index, not by campaign id. If the same
    // campaign is passed twice (caller bug), it gets double weight — proving
    // requestAd must supply a deduplicated eligible set.
    const campaigns = [
      { id: 'x', currency: 'USD', bidAmountMinor: 10n },
      { id: 'x', currency: 'USD', bidAmountMinor: 10n },
      { id: 'y', currency: 'USD', bidAmountMinor: 10n },
    ];
    const seen = { x: 0, y: 0 };
    for (let k = 0; k < 6000; k++) {
      seen[campaigns[selectCampaignIndex(campaigns)].id as 'x' | 'y']++;
    }
    expect(seen.x / 6000).toBeGreaterThan(0.6);
    expect(seen.y / 6000).toBeLessThan(0.4);
  });
});
