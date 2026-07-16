import { describe, expect, it } from 'vitest';

import {
  campaignMoneyInputPolicy,
  MIN_CAMPAIGN_BUDGET_MINOR,
  parseCampaignAmountMinor,
} from './campaign-money';

describe('campaign money input policy', () => {
  it('uses cents and a currency-formatted floor for USD', () => {
    expect(campaignMoneyInputPolicy('USD')).toEqual({
      minorUnitStep: '0.01',
      minimumBid: '0.01',
      minimumBudget: '50',
      minimumBudgetLabel: '$50.00',
    });
    expect(MIN_CAMPAIGN_BUDGET_MINOR).toBe(5000n);
  });

  it('uses whole units and the same shared minor-unit floor for JPY', () => {
    const policy = campaignMoneyInputPolicy('JPY');
    expect(policy).toMatchObject({
      minorUnitStep: '1',
      minimumBid: '1',
      minimumBudget: '5000',
    });
    expect(policy.minimumBudgetLabel).toContain('5,000');
    expect(parseCampaignAmountMinor('5000', 'JPY')).toBe(5000n);
  });

  it('rejects empty and non-numeric input before bigint conversion', () => {
    expect(parseCampaignAmountMinor('', 'USD')).toBeNull();
    expect(parseCampaignAmountMinor('not-an-amount', 'USD')).toBeNull();
  });
});
