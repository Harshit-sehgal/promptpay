// A-030: All five payout providers ship as 'available'. PayPal Payouts, Stripe
// Connect, and Wise are automated rails; paypal_email and manual are
// admin-processed. Which automated rails are actually live at the
// provider-account level is an OPERATOR launch decision (credentials/approval),
// not a code change — see AGENTS.md.
//
// To let operators gate a provider on/off at deploy time WITHOUT a code edit,
// the static statuses below can be overridden per-environment via
// NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS — a JSON map of
// provider -> 'available' | 'coming_soon'. Example:
//   {"wise":"coming_soon","stripe_connect":"coming_soon"}
// Unknown provider keys and invalid status values are ignored so a typo in the
// env var never silently breaks the payout selector.

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
  const validStatuses: PayoutProviderLaunchStatus[] = ['available', 'coming_soon'];
  return base.map((p) => {
    const next = map[p.provider];
    if (typeof next === 'string' && (validStatuses as string[]).includes(next)) {
      return { ...p, status: next as PayoutProviderLaunchStatus };
    }
    return p;
  });
}

// Resolved at module load. In the browser, only NEXT_PUBLIC_* env vars are
// inlined by the Next.js build, so operators set that variable in the web
// deploy environment.
export const RESOLVED_PAYOUT_PROVIDERS = applyPayoutProviderOverrides(
  PAYOUT_PROVIDERS,
  process.env.NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS,
);

export const AVAILABLE_PAYOUT_PROVIDERS = RESOLVED_PAYOUT_PROVIDERS.filter(
  (p) => p.status === 'available',
);

export const COMING_SOON_PAYOUT_PROVIDERS = RESOLVED_PAYOUT_PROVIDERS.filter(
  (p) => p.status === 'coming_soon',
);
