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

/** Minor-unit exponent for a currency (defaults to 2 when unknown). */
export function minorUnitExponent(code: string | null | undefined): number {
  return getCurrencyPolicy(code)?.minorUnitExponent ?? 2;
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
