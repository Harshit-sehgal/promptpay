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
      JSON.stringify({ paypal_payouts: 'available' }),
    );
    const paypalPayouts = resolved.find((p) => p.provider === 'paypal_payouts');
    expect(paypalPayouts?.status).toBe('available');
    expect(resolved.find((p) => p.provider === 'paypal_email')?.status).toBe('available');
  });

  it('ignores unknown provider keys', () => {
    const resolved = applyPayoutProviderOverrides(
      PAYOUT_PROVIDERS,
      JSON.stringify({ does_not_exist: 'available' }),
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
  it('exposes only admin-processed providers without an explicit deploy override', () => {
    expect(AVAILABLE_PAYOUT_PROVIDERS.map((p) => p.provider).sort()).toEqual([
      'manual',
      'paypal_email',
    ]);
    expect(COMING_SOON_PAYOUT_PROVIDERS.map((p) => p.provider).sort()).toEqual([
      'payoneer',
      'paypal_payouts',
      'razorpay',
      'stripe_connect',
      'wise',
    ]);
  });
});
