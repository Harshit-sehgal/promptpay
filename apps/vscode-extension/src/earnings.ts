import {
  type ConversionQuote,
  convertMoney,
  formatMinorUnits,
  parseMinor,
  primaryCurrency,
} from '@waitlayer/shared';

/**
 * P1.4 — mixed-currency client rendering helpers.
 *
 * All currency math here defers to `@waitlayer/shared` (`primaryCurrency`,
 * `formatMinorUnits`, `convertMoney`) so the extension and server agree on
 * semantics. The API serializes BigInt monetary columns as decimal strings;
 * `byCurrency` therefore arrives as `Record<string, string>` and we parse it
 * back to exact bigints before any arithmetic or formatting.
 */

/** Parse the API's stringified per-currency map into exact bigints. */
export function parseByCurrency(
  byCurrency: Record<string, string> | undefined,
): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  if (!byCurrency) return out;
  for (const [currency, raw] of Object.entries(byCurrency)) {
    out[currency] = parseMinor(raw);
  }
  return out;
}

export interface DisplayResolution {
  /** Currency to render. */
  currency: string;
  /**
   * Set when `preferredDisplayCurrency` was set but is NOT present in the
   * balance. We must not fabricate a converted total, so we fall back to the
   * primary currency and surface this note instead.
   */
  note?: string;
  /** True when `currency` came directly from the user's preference. */
  fromPreferred: boolean;
}

/**
 * Resolve which currency to display.
 *  - No preference → the deterministic primary currency (first positive balance
 *    in ascending ISO-4217 order) via `@waitlayer/shared#primaryCurrency`.
 *  - Preference present in `byCurrency` → that currency.
 *  - Preference present but ABSENT from `byCurrency` → show the primary
 *    currency and a clear note; do NOT fabricate an FX-converted total (the
 *    backend does not yet return conversion quotes).
 *  - No usable per-currency data → the legacy scalar `fallbackCurrency`.
 */
export function resolveDisplayCurrency(
  byCurrency: Record<string, string> | undefined,
  preferred: string | undefined,
  fallbackCurrency: string,
): DisplayResolution {
  const map = parseByCurrency(byCurrency);
  const hasPositive = Object.values(map).some((v) => v > 0n);
  if (!hasPositive) {
    return { currency: fallbackCurrency, fromPreferred: false };
  }
  const primary = primaryCurrency(map);
  if (!preferred) return { currency: primary, fromPreferred: false };
  if (byCurrency && preferred in byCurrency) {
    return { currency: preferred, fromPreferred: true };
  }
  return {
    currency: primary,
    note: `No balance held in ${preferred}; showing ${primary} (conversion quote unavailable).`,
    fromPreferred: false,
  };
}

/**
 * Guard for cross-currency conversion. Uses `@waitlayer/shared#convertMoney`
 * ONLY when a REAL quote is supplied — it never fabricates a rate. Without a
 * quote (the current backend state) it returns the amount unchanged, so a
 * caller can never silently invent a converted total.
 */
export function convertIfQuoted(
  amountMinor: bigint,
  currency: string,
  quote?: ConversionQuote,
): { amountMinor: bigint; currency: string } {
  if (!quote || quote.from !== currency) return { amountMinor, currency };
  const converted = convertMoney({ amountMinor, currency }, quote);
  return { amountMinor: converted.amountMinor, currency: converted.currency };
}

/** Per-currency formatted breakdown lines for an earnings view. */
export function formatBreakdown(byCurrency: Record<string, string> | undefined): string[] {
  const map = parseByCurrency(byCurrency);
  return Object.keys(map)
    .sort()
    .map((currency) => `${currency}: ${formatMinorUnits(map[currency], currency)}`);
}
