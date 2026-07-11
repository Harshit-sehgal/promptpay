import { PayoutProvider } from './enums';

/**
 * Per-currency policy table.
 *
 * A global SaaS cannot treat every currency as 2-decimal USD: zero-decimal
 * currencies (JPY, KRW), 3-decimal currencies (BHD, KWD), and per-currency
 * deposit/payout floors all need an explicit, single source of truth. Adding
 * or removing a supported currency is a one-line change here - DTO validation,
 * API thresholds, web formatting, and provider selection all read from it.
 */
export interface CurrencyPolicy {
  /** ISO 4217 code (uppercase). */
  code: string;
  /** Number of decimal places in one major unit (2 for USD, 0 for JPY, 3 for BHD). */
  minorUnitExponent: number;
  /** Minimum deposit in minor units (per currency). */
  depositMinimumMinor: number;
  /** Minimum payout in minor units (per currency). */
  payoutMinimumMinor: number;
  /** Payout providers that can settle in this currency. */
  providers: PayoutProvider[];
}

export const CURRENCY_POLICY: Record<string, CurrencyPolicy> = {
  USD: {
    code: 'USD',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [
      PayoutProvider.PAYPAL_EMAIL,
      PayoutProvider.PAYPAL_PAYOUTS,
      PayoutProvider.STRIPE_CONNECT,
      PayoutProvider.WISE,
      PayoutProvider.MANUAL,
    ],
  },
  EUR: {
    code: 'EUR',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [
      PayoutProvider.PAYPAL_EMAIL,
      PayoutProvider.PAYPAL_PAYOUTS,
      PayoutProvider.STRIPE_CONNECT,
      PayoutProvider.WISE,
      PayoutProvider.MANUAL,
    ],
  },
  GBP: {
    code: 'GBP',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [
      PayoutProvider.PAYPAL_EMAIL,
      PayoutProvider.PAYPAL_PAYOUTS,
      PayoutProvider.STRIPE_CONNECT,
      PayoutProvider.WISE,
      PayoutProvider.MANUAL,
    ],
  },
  CAD: {
    code: 'CAD',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [PayoutProvider.WISE, PayoutProvider.PAYPAL_EMAIL, PayoutProvider.MANUAL],
  },
  AUD: {
    code: 'AUD',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [PayoutProvider.WISE, PayoutProvider.PAYPAL_EMAIL, PayoutProvider.MANUAL],
  },
  INR: {
    code: 'INR',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [PayoutProvider.WISE, PayoutProvider.MANUAL],
  },
  // Non-USD / non-decimal-2 example: JPY is a zero-decimal currency.
  JPY: {
    code: 'JPY',
    minorUnitExponent: 0,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [PayoutProvider.WISE, PayoutProvider.MANUAL],
  },
  BRL: {
    code: 'BRL',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    providers: [PayoutProvider.WISE, PayoutProvider.PAYPAL_EMAIL, PayoutProvider.MANUAL],
  },
};

const DEFAULT_POLICY: CurrencyPolicy = {
  code: 'USD',
  minorUnitExponent: 2,
  depositMinimumMinor: 100,
  payoutMinimumMinor: 1000,
  providers: [PayoutProvider.MANUAL],
};

export function getCurrencyPolicy(code: string | null | undefined): CurrencyPolicy | null {
  if (!code) return null;
  return CURRENCY_POLICY[code.toUpperCase()] ?? null;
}

export function isSupportedCurrency(code: string | null | undefined): boolean {
  return getCurrencyPolicy(code) !== null;
}

/**
 * Choose a single "primary" currency from a per-currency minor-unit totals
 * map. Used by summary endpoints whose contract still exposes a single
 * `currency` / `amountMinor` scalar alongside a full `byCurrency` map.
 *
 * Picks the currency with the strictly-largest positive balance; if the map
 * is empty or every entry is non-positive, falls back to `'USD'`.
 *
 * This is the fix for the multi-currency bug class where summary scalars
 * were hard-pinned to `'USD'`: the primary currency is now derived
 * from the user's ACTUAL balances, not assumed USD.
 */
export function primaryCurrency(totals: Record<string, number>): string {
  let best = 'USD';
  let bestAmount = 0;
  for (const [currency, amount] of Object.entries(totals)) {
    if (amount > bestAmount) {
      bestAmount = amount;
      best = currency;
    }
  }
  return best;
}

/** Minor-unit exponent for a currency (defaults to 2 when unknown). */
export function minorUnitExponent(code: string | null | undefined): number {
  return getCurrencyPolicy(code)?.minorUnitExponent ?? 2;
}

/**
 * Convert a user-entered major-unit amount (e.g. "30.00" USD or "1000" JPY)
 * into integer minor units, respecting the currency's actual minor-unit
 * exponent. Avoids the JPY 100x bug that a hardcoded `* 100` produces.
 */
export function majorToMinor(majorAmount: number, currency = 'USD'): number {
  const exponent = minorUnitExponent(currency);
  const factor = 10 ** exponent;
  // Round to the nearest minor unit; guard against floating-point drift.
  return Math.round((majorAmount + Number.EPSILON) * factor);
}

/**
 * Convert integer minor units back into a major-unit input value string for
 * form fields (e.g. 3000 USD minor -> "30", 1000 JPY minor -> "1000").
 */
export function minorToMajorInputValue(minorUnits: number, currency = 'USD'): string {
  const exponent = minorUnitExponent(currency);
  const major = minorUnits / 10 ** exponent;
  return major.toString();
}

/** Per-currency deposit floor, or the USD default when the code is unknown. */
export function depositMinimumMinor(code: string | null | undefined): number {
  return getCurrencyPolicy(code)?.depositMinimumMinor ?? DEFAULT_POLICY.depositMinimumMinor;
}

/** Per-currency payout floor, or the USD default when the code is unknown. */
export function payoutMinimumMinor(code: string | null | undefined): number {
  return getCurrencyPolicy(code)?.payoutMinimumMinor ?? DEFAULT_POLICY.payoutMinimumMinor;
}

/** Whether the given provider can settle the given currency. */
export function isProviderSupportedForCurrency(
  provider: PayoutProvider,
  code: string | null | undefined,
): boolean {
  const policy = getCurrencyPolicy(code);
  if (!policy) return false;
  return policy.providers.includes(provider);
}

/**
 * Convert minor units to a major-unit display string respecting the
 * currency's actual minor-unit exponent (e.g. JPY 1000 -> "¥1,000", not
 * "¥10.00"). Falls back to 2 decimals for unknown currencies.
 */
export function formatMinorUnits(minorUnits: number, currency = 'USD'): string {
  const exponent = minorUnitExponent(currency);
  const major = minorUnits / 10 ** exponent;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(major);
}
