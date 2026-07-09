// A-030 (resolved 2026-07-09): All five payout providers are now marked
// 'available'. PayPal Payouts, Stripe Connect, and Wise are automated rails
// enabled at launch alongside the admin-processed paypal_email and manual
// methods. The payout API recognizes all five provider keys.

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

export const AVAILABLE_PAYOUT_PROVIDERS = PAYOUT_PROVIDERS.filter((p) => p.status === 'available');

export const COMING_SOON_PAYOUT_PROVIDERS = PAYOUT_PROVIDERS.filter(
  (p) => p.status === 'coming_soon',
);
