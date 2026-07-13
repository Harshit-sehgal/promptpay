import { describe, expect, it } from 'vitest';

import {
  applyPayoutProviderOverrides,
  AVAILABLE_PAYOUT_PROVIDERS,
  COMING_SOON_PAYOUT_PROVIDERS,
  PAYOUT_PROVIDERS,
} from './payout-providers';

describe('applyPayoutProviderOverrides (A-030)', () => {
  it('returns the base list unchanged when no override JSON is supplied', () => {
    expect(applyPayoutProviderOverrides(PAYOUT_PROVIDERS)).toEqual(PAYOUT_PROVIDERS);
  });

  it('returns the base list unchanged for malformed JSON', () => {
    expect(applyPayoutProviderOverrides(PAYOUT_PROVIDERS, '{not json')).toEqual(PAYOUT_PROVIDERS);
  });

  it('returns the base list unchanged for non-object JSON', () => {
    expect(applyPayoutProviderOverrides(PAYOUT_PROVIDERS, '42')).toEqual(PAYOUT_PROVIDERS);
    expect(applyPayoutProviderOverrides(PAYOUT_PROVIDERS, 'null')).toEqual(PAYOUT_PROVIDERS);
  });

  it('overrides a known provider status', () => {
    const resolved = applyPayoutProviderOverrides(
      PAYOUT_PROVIDERS,
      JSON.stringify({ stripe_connect: 'coming_soon' }),
    );
    const stripeConnect = resolved.find((p) => p.provider === 'stripe_connect');
    expect(stripeConnect?.status).toBe('coming_soon');
    // Other providers are untouched.
    expect(resolved.find((p) => p.provider === 'paypal_email')?.status).toBe('available');
  });

  it('ignores unknown provider keys', () => {
    const resolved = applyPayoutProviderOverrides(
      PAYOUT_PROVIDERS,
      JSON.stringify({ does_not_exist: 'coming_soon' }),
    );
    expect(resolved).toEqual(PAYOUT_PROVIDERS);
  });

  it('ignores invalid status values', () => {
    const resolved = applyPayoutProviderOverrides(
      PAYOUT_PROVIDERS,
      JSON.stringify({ paypal_email: 'disabled' }),
    );
    expect(resolved.find((p) => p.provider === 'paypal_email')?.status).toBe('available');
  });

  it('does not mutate the base array', () => {
    const base = PAYOUT_PROVIDERS.map((p) => ({ ...p }));
    applyPayoutProviderOverrides(base, JSON.stringify({ paypal_email: 'coming_soon' }));
    expect(base.find((p) => p.provider === 'paypal_email')?.status).toBe('available');
  });
});

describe('resolved provider lists honour operator overrides at module load', () => {
  it('default (no env) gates the coming-soon providers and exposes the available ones', () => {
    // The test process does not set NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS.
    // The base catalogue (single source of truth in @waitlayer/shared) lists
    // four providers available at launch (paypal_email, manual, paypal_payouts,
    // stripe_connect) and three coming-soon (wise — corridor must be verified
    // by the operator; payoneer + razorpay — integrations not yet built). The
    // coming-soon entries exist so operators can promote them via the env-var
    // override at deploy time without a code edit; the API layer still
    // fail-closes registration for unsupported providers.
    expect(AVAILABLE_PAYOUT_PROVIDERS.map((p) => p.provider).sort()).toEqual([
      'manual',
      'paypal_email',
      'paypal_payouts',
      'stripe_connect',
    ]);
    expect(COMING_SOON_PAYOUT_PROVIDERS.map((p) => p.provider).sort()).toEqual([
      'payoneer',
      'razorpay',
      'wise',
    ]);
  });
});
