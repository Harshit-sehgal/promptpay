import { minorUnitExponent } from '@waitlayer/shared';

export interface PayoutAmountSource {
  requestedAmountMinor: bigint;
  approvedAmountMinor?: bigint | null;
}

export function authoritativePayoutAmountMinor(payout: PayoutAmountSource): bigint {
  return payout.approvedAmountMinor ?? payout.requestedAmountMinor;
}

/** Format a bigint amount for a major-unit form field without narrowing to Number. */
export function minorToMajorInputValue(minorUnits: bigint, currency = 'USD'): string {
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return minorUnits.toString();

  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const factor = 10n ** BigInt(exponent);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(exponent, '0').replace(/0+$/, '');

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Parse a major-unit form value into bigint minor units without floating-point arithmetic. */
export function majorInputToMinor(value: string, currency = 'USD'): bigint | null {
  const normalized = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  const [rawWhole, rawFraction = ''] = normalized.split('.');
  const exponent = minorUnitExponent(currency);
  const excessFraction = rawFraction.slice(exponent);
  if (/[^0]/.test(excessFraction)) return null;

  const whole = BigInt(rawWhole || '0');
  const fraction = rawFraction.slice(0, exponent).padEnd(exponent, '0');
  const factor = 10n ** BigInt(exponent);
  return whole * factor + BigInt(fraction || '0');
}
