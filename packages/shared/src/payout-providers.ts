// Manual payouts are the only launch-safe defaults because they do not depend
// on external PSP credentials or account-level feature approval. Automated
// providers stay coming_soon until an operator has configured credentials,
// completed a sandbox transfer, and explicitly promotes the provider through
// the deploy-time override.
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
    status: 'coming_soon',
    note: 'Coming soon — enable only after credentials and sandbox verification',
  },
  {
    provider: 'stripe_connect',
    label: 'Stripe Connect',
    status: 'coming_soon',
    note: 'Coming soon — requires an approved Connect platform and tested onboarding',
  },
  {
    provider: 'wise',
    label: 'Wise',
    status: 'coming_soon',
    note: 'Coming soon — requires verified Wise recipient capability',
  },
  {
    provider: 'payoneer',
    label: 'Payoneer',
    status: 'coming_soon',
    note: 'Coming soon — Payoneer integration not yet available',
  },
  {
    provider: 'razorpay',
    label: 'Razorpay',
    status: 'coming_soon',
    note: 'Coming soon — Razorpay integration not yet available',
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
 * Starts from the checked-in catalogue and applies a valid operator override.
 * Unknown providers fail closed as coming_soon. This prevents an absent or
 * malformed environment variable from silently turning a gated provider on.
 */
export function payoutProviderLaunchStatus(
  provider: string,
  overridesJson?: string,
): PayoutProviderLaunchStatus {
  const base = PAYOUT_PROVIDERS.find((entry) => entry.provider === provider)?.status;
  if (!base) return 'coming_soon';
  if (!overridesJson) return base;
  let overrides: unknown;
  try {
    overrides = JSON.parse(overridesJson);
  } catch {
    return base;
  }
  if (typeof overrides !== 'object' || overrides === null) return base;
  const map = overrides as Record<string, unknown>;
  const override = map[provider];
  return typeof override === 'string' && (VALID_LAUNCH_STATUSES as string[]).includes(override)
    ? (override as PayoutProviderLaunchStatus)
    : base;
}
