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
      JSON.stringify({ wise: 'coming_soon' }),
    );
    const wise = resolved.find((p) => p.provider === 'wise');
    expect(wise?.status).toBe('coming_soon');
    // Other providers are untouched.
    expect(resolved.find((p) => p.provider === 'stripe_connect')?.status).toBe('available');
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
      JSON.stringify({ wise: 'disabled' }),
    );
    expect(resolved.find((p) => p.provider === 'wise')?.status).toBe('available');
  });

  it('does not mutate the base array', () => {
    const base = PAYOUT_PROVIDERS.map((p) => ({ ...p }));
    applyPayoutProviderOverrides(base, JSON.stringify({ wise: 'coming_soon' }));
    expect(base.find((p) => p.provider === 'wise')?.status).toBe('available');
  });
});

describe('resolved provider lists honour operator overrides at module load', () => {
  it('default (no env) exposes all five providers as available', () => {
    // The test process does not set NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS.
    expect(AVAILABLE_PAYOUT_PROVIDERS).toHaveLength(5);
    expect(COMING_SOON_PAYOUT_PROVIDERS).toHaveLength(0);
  });
});
