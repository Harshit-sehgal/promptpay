import { describe, expect, it } from 'vitest';

import { selectablePayoutProviders } from './page';

describe('effective payout-provider readiness', () => {
  it('fails closed when readiness could not be fetched', () => {
    expect(selectablePayoutProviders(undefined)).toEqual([]);
  });

  it('never exposes an API-unready provider as selectable', () => {
    const providers = selectablePayoutProviders([
      { provider: 'manual', label: 'Manual', status: 'available', note: '', reason: null },
      {
        provider: 'stripe_connect',
        label: 'Stripe',
        status: 'coming_soon',
        note: '',
        reason: 'credentials missing',
      },
    ]);
    expect(providers.map((item) => item.provider)).toEqual(['manual']);
  });
});
