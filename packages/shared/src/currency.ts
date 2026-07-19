import { PayoutProvider } from './enums';
import { parseMajorToMinor } from './parse';

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
  /**
   * Minimum campaign budget in this currency's OWN minor units. Re-thought per
   * currency so a `$50` floor is never accidentally applied as `¥50` or as
   * `5 BHD`. These are explicitly configured nominal thresholds (no live FX in
   * the money-critical path), the single source of truth used by DTO/service
   * validation and web form labels.
   */
  campaignMinimumBudgetMinor: number;
  /** Maximum campaign budget in this currency's own minor units. */
  campaignMaximumBudgetMinor: number;
  /** Minimum per-event bid in this currency's own minor units. */
  campaignMinimumBidMinor: number;
  /** Payout providers that can settle in this currency. */
  providers: PayoutProvider[];
}

export const CURRENCY_POLICY: Record<string, CurrencyPolicy> = {
  USD: {
    code: 'USD',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    campaignMinimumBudgetMinor: 5_000, // $50 minimum
    campaignMaximumBudgetMinor: 100_000_000, // $1,000,000 maximum
    campaignMinimumBidMinor: 100, // $1.00 minimum per-event bid
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
    campaignMinimumBudgetMinor: 5_000,
    campaignMaximumBudgetMinor: 100_000_000,
    campaignMinimumBidMinor: 100,
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
    campaignMinimumBudgetMinor: 5_000,
    campaignMaximumBudgetMinor: 100_000_000,
    campaignMinimumBidMinor: 100,
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
    campaignMinimumBudgetMinor: 5_000,
    campaignMaximumBudgetMinor: 100_000_000,
    campaignMinimumBidMinor: 100,
    providers: [PayoutProvider.WISE, PayoutProvider.PAYPAL_EMAIL, PayoutProvider.MANUAL],
  },
  AUD: {
    code: 'AUD',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    campaignMinimumBudgetMinor: 5_000,
    campaignMaximumBudgetMinor: 100_000_000,
    campaignMinimumBidMinor: 100,
    providers: [PayoutProvider.WISE, PayoutProvider.PAYPAL_EMAIL, PayoutProvider.MANUAL],
  },
  INR: {
    code: 'INR',
    minorUnitExponent: 2,
    depositMinimumMinor: 100, // ₹1 deposit floor
    payoutMinimumMinor: 1000, // ₹10 payout floor
    // ~$50-equivalent nominal thresholds in INR's own paise (explicitly
    // configured, NOT the USD 5000-minor value re-applied — that would be a
    // ₹50 minimum, an order of magnitude low).
    campaignMinimumBudgetMinor: 400_000, // ₹4,000
    campaignMaximumBudgetMinor: 80_000_000_000, // ₹80,00,00,000 (= 8,000,000,000 paise)
    campaignMinimumBidMinor: 1_000, // ₹10
    providers: [PayoutProvider.WISE, PayoutProvider.MANUAL],
  },
  // Non-USD / non-decimal-2 example: JPY is a zero-decimal currency.
  JPY: {
    code: 'JPY',
    minorUnitExponent: 0,
    depositMinimumMinor: 100, // ¥100 deposit floor
    payoutMinimumMinor: 1000, // ¥1,000 payout floor
    // ~$50-equivalent nominal thresholds in JPY's own minor units (== major).
    // If the USD 5000-minor floor were re-applied, JPY exponent 0 would make
    // the minimum budget ¥5,000 (~$33). Use ¥7,500 (~$50) and ¥100 min bid.
    campaignMinimumBudgetMinor: 7_500, // ¥7,500
    campaignMaximumBudgetMinor: 150_000_000, // ¥150,000,000
    campaignMinimumBidMinor: 100, // ¥100
    providers: [PayoutProvider.WISE, PayoutProvider.MANUAL],
  },
  BRL: {
    code: 'BRL',
    minorUnitExponent: 2,
    depositMinimumMinor: 100,
    payoutMinimumMinor: 1000,
    campaignMinimumBudgetMinor: 5_000,
    campaignMaximumBudgetMinor: 500_000_00,
    campaignMinimumBidMinor: 100,
    providers: [PayoutProvider.WISE, PayoutProvider.PAYPAL_EMAIL, PayoutProvider.MANUAL],
  },
};

const DEFAULT_POLICY: CurrencyPolicy = {
  code: 'USD',
  minorUnitExponent: 2,
  depositMinimumMinor: 100,
  payoutMinimumMinor: 1000,
  // USD defaults used when a currency code is unknown — these are USD-shaped
  // 2-decimal thresholds. For unknown/supported-but-unmapped currencies the
  // explicit policy entries above are authoritative.
  campaignMinimumBudgetMinor: 5_000,
  campaignMaximumBudgetMinor: 100_000_000,
  campaignMinimumBidMinor: 100,
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
 * IMPORTANT: this MUST NOT be read as "the currency with the most money".
 * Raw minor units are NOT comparable across currencies — `100` JPY minor
 * units and `100` USD cents are not the same amount, so picking the
 * "largest" by raw minor value is a cross-currency aggregation bug. The
 * authoritative representation is the full `byCurrency` map; the scalar
 * exists only for backward compatibility.
 *
 * The deterministic contract here is: the FIRST positive-balance currency
 * in ascending ISO-4217 code order. This is a deliberately-stable pick (not
 * a magnitude claim), so consumers always know which currency the scalar
 * represents. Falls back to `'USD'` only when the map is empty or every
 * entry is non-positive (so a user with only non-USD funds never silently
 * gets a USD scalar).
 *
 * Callers that need a user-preferred or display currency should read that
 * explicitly rather than relying on this function.
 */
export function primaryCurrency(totals: Record<string, bigint>): string {
  const codes = Object.keys(totals).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const currency of codes) {
    if (totals[currency] > 0n) return currency;
  }
  return 'USD';
}

/** Minor-unit exponent for a currency (defaults to 2 when unknown). */
export function minorUnitExponent(code: string | null | undefined): number {
  return getCurrencyPolicy(code)?.minorUnitExponent ?? 2;
}

/**
 * Convert a user-entered major-unit amount (e.g. "30.00" USD or "1000" JPY)
 * into integer minor units, respecting the currency's actual minor-unit
 * exponent. Now uses the exact decimal parser (`parseMajorToMinor`) instead of
 * `Number(value)` arithmetic — no precision loss above 2^53, and rejects
 * malformed/excess-decimal input instead of silently rounding. Accepts a
 * `number` for convenience but rejects `NaN`/`Infinity`.
 */
export function majorToMinor(majorAmount: string | number, currency = 'USD'): bigint {
  return parseMajorToMinor(majorAmount, minorUnitExponent(currency));
}

/**
 * Convert integer minor units back into a major-unit input value string for
 * form fields (e.g. 3000 USD minor -> "30", 3050 USD minor -> "30.5",
 * 1000 JPY minor -> "1000"). Bigint-exact integer division (never
 * `Number(minorUnits) / divisor`, which rounds large values).
 */
export function minorToMajorInputValue(minorUnits: bigint, currency = 'USD'): string {
  const exponent = minorUnitExponent(currency);
  const factor = 10n ** BigInt(exponent);
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const whole = absolute / factor;
  const frac = exponent > 0 ? (absolute % factor).toString().padStart(exponent, '0') : '';
  // Trim trailing zeros from the fraction for a clean input value.
  const trimmedFrac = frac.replace(/0+$/, '');
  const sign = negative ? '-' : '';
  const wholeStr = whole.toString();
  return trimmedFrac.length > 0 ? `${sign}${wholeStr}.${trimmedFrac}` : `${sign}${wholeStr}`;
}

/** Per-currency deposit floor, or the USD default when the code is unknown. */
export function depositMinimumMinor(code: string | null | undefined): bigint {
  return BigInt(getCurrencyPolicy(code)?.depositMinimumMinor ?? DEFAULT_POLICY.depositMinimumMinor);
}

/** Per-currency payout floor, or the USD default when the code is unknown. */
export function payoutMinimumMinor(code: string | null | undefined): bigint {
  return BigInt(getCurrencyPolicy(code)?.payoutMinimumMinor ?? DEFAULT_POLICY.payoutMinimumMinor);
}

/** Per-currency minimum campaign budget in that currency's own minor units. */
export function campaignMinimumBudgetMinor(code: string | null | undefined): bigint {
  return BigInt(
    getCurrencyPolicy(code)?.campaignMinimumBudgetMinor ??
      DEFAULT_POLICY.campaignMinimumBudgetMinor,
  );
}

/** Per-currency maximum campaign budget in that currency's own minor units. */
export function campaignMaximumBudgetMinor(code: string | null | undefined): bigint {
  return BigInt(
    getCurrencyPolicy(code)?.campaignMaximumBudgetMinor ??
      DEFAULT_POLICY.campaignMaximumBudgetMinor,
  );
}

/** Per-currency minimum per-event bid in that currency's own minor units. */
export function campaignMinimumBidMinor(code: string | null | undefined): bigint {
  return BigInt(
    getCurrencyPolicy(code)?.campaignMinimumBidMinor ?? DEFAULT_POLICY.campaignMinimumBidMinor,
  );
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
export function formatMinorUnits(minorUnits: bigint, currency = 'USD'): string {
  const exponent = minorUnitExponent(currency);
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const factor = 10n ** BigInt(exponent);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(exponent, '0');
  const groupedWhole = new Intl.NumberFormat('en-US', {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(whole);
  const exactNumber = `${groupedWhole}${exponent > 0 ? `.${fraction}` : ''}`;
  const parts = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).formatToParts(negative ? -1 : 1);
  const numericParts = new Set(['integer', 'group', 'decimal', 'fraction']);
  let insertedNumber = false;

  return parts
    .map((part) => {
      if (!numericParts.has(part.type)) return part.value;
      if (insertedNumber) return '';
      insertedNumber = true;
      return exactNumber;
    })
    .join('');
}
