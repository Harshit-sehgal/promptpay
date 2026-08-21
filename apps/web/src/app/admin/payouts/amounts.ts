import { majorToMinor, minorToMajorInputValue, minorUnitExponent } from '@ateva/shared';

export { minorToMajorInputValue };

export interface PayoutAmountSource {
  requestedAmountMinor: bigint;
  approvedAmountMinor?: bigint | null;
}

export function authoritativePayoutAmountMinor(payout: PayoutAmountSource): bigint {
  return payout.approvedAmountMinor ?? payout.requestedAmountMinor;
}

/**
 * Parse a major-unit form value into bigint minor units without
 * floating-point arithmetic. Null-returning wrapper around the shared
 * exact parser so form validation can treat malformed input as "invalid"
 * instead of throwing. Leading-dot values (".5") are padded to "0.5", and
 * excess decimals that are all trailing zeros ("1000.0" for exponent-0
 * currencies like JPY) are trimmed — both preserve the legacy
 * form-acceptance contract.
 */
export function majorInputToMinor(value: string, currency = 'USD'): bigint | null {
  const normalized = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const padded = normalized.startsWith('.') ? `0${normalized}` : normalized;
  try {
    return majorToMinor(padded, currency);
  } catch {
    const [whole, frac = ''] = padded.split('.');
    const exponent = minorUnitExponent(currency);
    if (frac.length > exponent && /^0+$/.test(frac.slice(exponent))) {
      try {
        return majorToMinor(`${whole}.${frac.slice(0, exponent)}`, currency);
      } catch {
        return null;
      }
    }
    return null;
  }
}
