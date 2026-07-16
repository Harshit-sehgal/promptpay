import {
  AD_SERVING,
  formatMinorUnits,
  majorToMinor,
  minorToMajorInputValue,
} from '@waitlayer/shared';

export const MIN_CAMPAIGN_BUDGET_MINOR = BigInt(AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR);

export function campaignMoneyInputPolicy(currency: string) {
  const minorUnitStep = minorToMajorInputValue(1n, currency);

  return {
    minorUnitStep,
    minimumBid: minorUnitStep,
    minimumBudget: minorToMajorInputValue(MIN_CAMPAIGN_BUDGET_MINOR, currency),
    minimumBudgetLabel: formatMinorUnits(MIN_CAMPAIGN_BUDGET_MINOR, currency),
  };
}

export function parseCampaignAmountMinor(value: string, currency: string): bigint | null {
  if (!value.trim()) return null;
  const majorAmount = Number(value);
  if (!Number.isFinite(majorAmount)) return null;
  return majorToMinor(majorAmount, currency);
}
