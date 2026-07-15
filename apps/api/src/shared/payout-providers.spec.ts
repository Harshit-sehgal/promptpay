import { describe, expect, it } from 'vitest';

import {
  applyPayoutProviderOverrides,
  PAYOUT_PROVIDERS,
  payoutProviderLaunchStatus,
} from '@waitlayer/shared';

const base = PAYOUT_PROVIDERS;

describe('payout provider launch gate (A-030)', () => {
  it('returns the base catalogue status when no override json is set', () => {
    // Wise is `coming_soon` in the checked-in catalogue (PAYOUT_PROVIDERS) and
    // the function deliberately resolves to that base value when no operator
    // override is present — the previous `null` sentinel was removed because
    // callers compare against the concrete `'coming_soon'` value rather than
    // against `null`. This assertion locks the base-catalog passthrough.
    expect(payoutProviderLaunchStatus('wise')).toBe('coming_soon');
  });

  it('blocks a provider explicitly set to coming_soon', () => {
    expect(payoutProviderLaunchStatus('wise', JSON.stringify({ wise: 'coming_soon' }))).toBe(
      'coming_soon',
    );
  });

  it('falls back to base catalogue status when json is malformed', () => {
    // Malformed JSON is treated as no-override and the function returns the
    // checked-in base value. Returning `null` would force every caller to
    // re-derive the base themselves; the base-catalog passthrough keeps the
    // contract simple.
    expect(payoutProviderLaunchStatus('wise', '{not json')).toBe('coming_soon');
  });

  it('applyPayoutProviderOverrides flips only the named provider', () => {
    // Override wise from its base coming_soon → available to genuinely test a
    // flip, while stripe_connect (also coming_soon) stays untouched.
    const resolved = applyPayoutProviderOverrides(base, JSON.stringify({ wise: 'available' }));
    expect(resolved.find((p) => p.provider === 'wise')!.status).toBe('available');
    expect(resolved.find((p) => p.provider === 'stripe_connect')!.status).toBe('coming_soon');
  });

  it('ignores unknown providers and invalid statuses (keeps base catalogue)', () => {
    // `bogus` is not a real provider, so it's silently ignored. `wise: nope`
    // is an invalid status string, so the override for wise is rejected and
    // wise stays at its checked-in base status (coming_soon). The point is:
    // a malformed env var never silently promotes a gated provider to
    // `available`.
    const resolved = applyPayoutProviderOverrides(
      base,
      JSON.stringify({ bogus: 'coming_soon', wise: 'nope' }),
    );
    expect(resolved.find((p) => p.provider === 'wise')!.status).toBe('coming_soon');
    // stripe_connect stays at its safe-seed base status (coming_soon) — the
    // bogus key and invalid status are both ignored, so nothing is promoted.
    expect(resolved.find((p) => p.provider === 'stripe_connect')!.status).toBe('coming_soon');
  });
});
