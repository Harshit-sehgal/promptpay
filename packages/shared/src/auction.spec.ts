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
