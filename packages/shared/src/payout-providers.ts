// A-030: All five payout providers ship as 'available'. PayPal Payouts, Stripe
// Connect, and Wise are automated rails; paypal_email and manual are
// admin-processed. Which automated rails are actually live at the
// provider-account level is an OPERATOR launch decision (credentials/approval),
// not a code change — see AGENTS.md.
//
// To let operators gate a provider on/off at deploy time WITHOUT a code edit,
// the static statuses can be overridden per-environment via a JSON map of
// provider -> 'available' | 'coming_soon' (NEXT_PUBLIC_WAITLAYER_PAYOUT_
// PROVIDER_STATUS on the web, WAITLAYER_PAYOUT_PROVIDER_STATUS on the API).
// Unknown provider keys and invalid status values are ignored so a typo in the
// env var never silently breaks the payout selector or registration.
//
// This module is the single source of truth for that gate, shared by the web
// UI and the API so both honour the same operator decision (A-030).

export type PayoutProviderLaunchStatus = 'available' | 'coming_soon';

export interface PayoutProviderInfo {
  /** Provider key as understood by the payout API. */
  provider: string;
  /** Human-friendly label. */
  label: string;
  /** Whether developers can use this provider today. */
  status: PayoutProviderLaunchStatus;
  /** Short explanation shown next to the provider selector. */
  note: string;
}

export const PAYOUT_PROVIDERS: PayoutProviderInfo[] = [
  {
    provider: 'paypal_email',
    label: 'PayPal (email)',
    status: 'available',
    note: 'Available — admin-processed at launch',
  },
  {
    provider: 'manual',
    label: 'Manual',
    status: 'available',
    note: 'Available — admin-processed at launch',
  },
  {
    provider: 'paypal_payouts',
    label: 'PayPal Payouts (automated)',
    status: 'available',
    note: 'Available — automated at launch',
  },
  {
    provider: 'stripe_connect',
    label: 'Stripe Connect',
    status: 'available',
    note: 'Available — automated at launch',
  },
  {
    provider: 'wise',
    label: 'Wise',
    status: 'available',
    note: 'Available — automated at launch',
  },
];

const VALID_LAUNCH_STATUSES: PayoutProviderLaunchStatus[] = ['available', 'coming_soon'];

/**
 * Apply operator overrides from a JSON map (provider -> status). Pure and
 * defensive: malformed JSON, unknown providers, and invalid statuses are all
 * ignored so a misconfigured env var cannot corrupt the selector.
 */
export function applyPayoutProviderOverrides(
  base: PayoutProviderInfo[],
  overridesJson?: string,
): PayoutProviderInfo[] {
  if (!overridesJson) return base;
  let overrides: unknown;
  try {
    overrides = JSON.parse(overridesJson);
  } catch {
    return base;
  }
  if (typeof overrides !== 'object' || overrides === null) return base;
  const map = overrides as Record<string, unknown>;
  return base.map((p) => {
    const next = map[p.provider];
    if (typeof next === 'string' && (VALID_LAUNCH_STATUSES as string[]).includes(next)) {
      return { ...p, status: next as PayoutProviderLaunchStatus };
    }
    return p;
  });
}

/**
 * Resolve a single provider's launch status from the operator override map.
 * Stable domain concept + test seam (allowed under ts-no-tiny-functions):
 * returns 'coming_soon' only when the provider is explicitly gated, 'available'
 * otherwise, or null when there is no override map at all. The API calls this
 * at registration so server-side payout creation honours the same gate the web
 * UI uses (A-030). Malformed/empty/unknown values return null (treated as
 * available by the caller).
 */
export function payoutProviderLaunchStatus(
  provider: string,
  overridesJson?: string,
): PayoutProviderLaunchStatus | null {
  if (!overridesJson) return null;
  let overrides: unknown;
  try {
    overrides = JSON.parse(overridesJson);
  } catch {
    return null;
  }
  if (typeof overrides !== 'object' || overrides === null) return null;
  const map = overrides as Record<string, unknown>;
  return map[provider] === 'coming_soon' ? 'coming_soon' : 'available';
}
