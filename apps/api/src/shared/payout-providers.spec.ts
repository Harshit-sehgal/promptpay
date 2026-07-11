import { describe, expect, it } from 'vitest';

import {
  applyPayoutProviderOverrides,
  PAYOUT_PROVIDERS,
  payoutProviderLaunchStatus,
} from '@waitlayer/shared';

const base = PAYOUT_PROVIDERS;

describe('payout provider launch gate (A-030)', () => {
  it('returns null when no override json is set', () => {
    expect(payoutProviderLaunchStatus('wise')).toBeNull();
  });

  it('blocks a provider explicitly set to coming_soon', () => {
    expect(payoutProviderLaunchStatus('wise', JSON.stringify({ wise: 'coming_soon' }))).toBe(
      'coming_soon',
    );
  });

  it('treats malformed json as not-blocked (null)', () => {
    expect(payoutProviderLaunchStatus('wise', '{not json')).toBeNull();
  });

  it('applyPayoutProviderOverrides flips only the named provider', () => {
    const resolved = applyPayoutProviderOverrides(base, JSON.stringify({ wise: 'coming_soon' }));
    expect(resolved.find((p) => p.provider === 'wise')!.status).toBe('coming_soon');
    expect(resolved.find((p) => p.provider === 'stripe_connect')!.status).toBe('available');
  });

  it('ignores unknown providers and invalid statuses', () => {
    const resolved = applyPayoutProviderOverrides(
      base,
      JSON.stringify({ bogus: 'coming_soon', wise: 'nope' }),
    );
    expect(resolved.find((p) => p.provider === 'wise')!.status).toBe('available');
  });
});
