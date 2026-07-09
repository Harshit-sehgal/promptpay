// A-030: The payout API recognizes automated providers (paypal_payouts,
// stripe_connect, wise) in addition to the two paths that are actually usable
// at launch (paypal_email, manual). Until the automated rails are enabled we
// only expose paypal_email/manual as selectable options, but we surface the
// launch status of every provider here so developers understand the manual,
// admin-processed path is the expected flow at launch.
//
// LOW-RISK: this is descriptive metadata only — it does NOT change which
// providers are selectable in the add-method form.

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
    note: 'Coming soon — invite-only',
  },
  {
    provider: 'stripe_connect',
    label: 'Stripe Connect',
    status: 'coming_soon',
    note: 'Coming soon — invite-only',
  },
  {
    provider: 'wise',
    label: 'Wise',
    status: 'coming_soon',
    note: 'Coming soon — invite-only',
  },
];

export const AVAILABLE_PAYOUT_PROVIDERS = PAYOUT_PROVIDERS.filter((p) => p.status === 'available');

export const COMING_SOON_PAYOUT_PROVIDERS = PAYOUT_PROVIDERS.filter(
  (p) => p.status === 'coming_soon',
);
