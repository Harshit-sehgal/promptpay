import { describe, expect, it } from 'vitest';

import { campaignMaximumBudgetMinor } from './currency';

describe('currency policy — INR campaign budget (P1.13)', () => {
  it('INR max budget is ₹80,00,00,000 = 8,000,000,000 paise (not ₹8 crore)', () => {
    expect(campaignMaximumBudgetMinor('INR')).toBe(80_000_000_000n);
  });

  it('round-trips to major units: 8,000,000,000 paise = 800,000,000 rupees = ₹80,00,00,000', () => {
    const minor = campaignMaximumBudgetMinor('INR');
    expect(minor / 100n).toBe(800_000_000n);
  });
});
