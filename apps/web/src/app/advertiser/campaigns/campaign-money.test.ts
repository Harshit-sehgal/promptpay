import { describe, expect, it } from 'vitest';

import { campaignMinimumBudgetMinor } from '@waitlayer/shared';

import {
  campaignMoneyInputPolicy,
  MIN_CAMPAIGN_BUDGET_MINOR,
  parseCampaignAmountMinor,
} from './campaign-money';

describe('campaign money input policy', () => {
  it('uses cents and a currency-formatted floor for USD', () => {
    expect(campaignMoneyInputPolicy('USD')).toEqual({
      minorUnitStep: '0.01',
      minimumBid: '1',
      minimumBudget: '50',
      maximumBudget: '1000000',
      minimumBudgetLabel: '$50.00',
    });
    expect(MIN_CAMPAIGN_BUDGET_MINOR).toBe(5000n);
  });

  it('uses whole units and a JPY-specific floor (not the USD 5000-minor value)', () => {
    // The old global constant re-applied the USD 5000-minor floor to JPY,
    // making the minimum budget ¥5,000 (~$33) — economically wrong for a
    // zero-decimal currency. The per-currency policy sets ¥7,500 (~$50).
    const policy = campaignMoneyInputPolicy('JPY');
    expect(policy).toMatchObject({
      minorUnitStep: '1',
      minimumBid: '100', // ¥100 minimum bid
      minimumBudget: '7500', // ¥7,500 — NOT 5000
      maximumBudget: '150000000',
    });
    expect(policy.minimumBudgetLabel).toContain('7,500');
    expect(parseCampaignAmountMinor('5000', 'JPY')).toBe(5000n);
    expect(campaignMinimumBudgetMinor('JPY')).toBe(7500n);
  });

  it('rejects empty and non-numeric input before bigint conversion', () => {
    expect(parseCampaignAmountMinor('', 'USD')).toBeNull();
    expect(parseCampaignAmountMinor('not-an-amount', 'USD')).toBeNull();
    expect(parseCampaignAmountMinor('10.001', 'USD')).toBeNull(); // excess decimals
  });

  it('parses exact values above Number.MAX_SAFE_INTEGER without rounding', () => {
    // 90,071,992,547,409.93 USD minor = 9007199254740993 — exceeds 2^53.
    // The old `Number(value)` path would round this; the exact parser keeps it.
    expect(parseCampaignAmountMinor('90071992547409.93', 'USD')).toBe(9007199254740993n);
  });
});
