import { describe, expect, it } from 'vitest';

import { depositAmountInputPolicy, depositPresetMinorUnits, parseDepositAmountMinor } from './page';

describe('deposit presets', () => {
  it('never offers a JPY preset below the per-currency minimum', () => {
    const presets = depositPresetMinorUnits('JPY');
    expect(presets).toEqual([100n, 250n, 500n]);
    expect(presets.every((amount) => amount >= 100n)).toBe(true);
  });

  it('keeps the expected USD major-unit choices', () => {
    expect(depositPresetMinorUnits('USD')).toEqual([100n, 5000n, 10000n, 25000n, 50000n]);
  });

  it('derives custom amount bounds and steps from the currency exponent', () => {
    expect(depositAmountInputPolicy('USD')).toEqual({
      minimumMinor: 100n,
      minimumMajor: '1',
      minorUnitStep: '0.01',
    });
    expect(depositAmountInputPolicy('JPY')).toEqual({
      minimumMinor: 100n,
      minimumMajor: '100',
      minorUnitStep: '1',
    });
  });

  it('parses custom amounts without assuming two decimal places', () => {
    expect(parseDepositAmountMinor('1.25', 'USD')).toBe(125n);
    expect(parseDepositAmountMinor('125', 'JPY')).toBe(125n);
    expect(parseDepositAmountMinor('', 'JPY')).toBeNull();
    expect(parseDepositAmountMinor('invalid', 'USD')).toBeNull();
  });
});
