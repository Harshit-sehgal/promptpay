import { describe, expect, it } from 'vitest';
import { payoutProviderStatusLabel, selectablePayoutProviders } from '@/lib/payout-readiness';

import { PayoutProvider, PayoutProviderReadinessResponse } from '@ateva/shared';

describe('effective payout-provider readiness', () => {
  it('fails closed when readiness could not be fetched', () => {
    expect(selectablePayoutProviders(undefined)).toEqual([]);
  });

  it('never exposes an API-unready provider as selectable', () => {
    const providers = selectablePayoutProviders([
      {
        provider: PayoutProvider.MANUAL,
        label: 'Manual',
        available: true,
        status: 'available',
        reasonCode: null,
        note: '',
        reason: null,
      },
      {
        provider: PayoutProvider.STRIPE_CONNECT,
        label: 'Stripe',
        available: false,
        status: 'temporarily_disabled',
        reasonCode: 'operator_disabled',
        note: '',
        reason: 'credentials missing',
      },
    ]);
    expect(providers.map((item) => item.provider)).toEqual(['manual']);
  });

  it('accepts the live API response shape', () => {
    expect(
      PayoutProviderReadinessResponse.parse({
        providers: [
          {
            provider: 'stripe_connect',
            label: 'Stripe Connect',
            available: true,
            status: 'available',
            reasonCode: null,
            note: 'Configured',
            reason: null,
          },
        ],
      }),
    ).toEqual({
      providers: [
        {
          provider: 'stripe_connect',
          label: 'Stripe Connect',
          available: true,
          status: 'available',
          reasonCode: null,
          note: 'Configured',
          reason: null,
        },
      ],
    });
  });

  it('labels distinct unavailable states honestly', () => {
    expect(payoutProviderStatusLabel('coming_soon')).toBe('Coming soon');
    expect(payoutProviderStatusLabel('temporarily_disabled')).toBe('Temporarily unavailable');
    expect(payoutProviderStatusLabel('unconfigured')).toBe('Not configured');
    expect(payoutProviderStatusLabel('unimplemented')).toBe('Not supported');
  });

  it('fails closed on a malformed or partial readiness response', () => {
    expect(
      PayoutProviderReadinessResponse.safeParse({ providers: [{ provider: 'manual' }] }).success,
    ).toBe(false);
    expect(PayoutProviderReadinessResponse.safeParse({ providers: 'manual' }).success).toBe(false);
    expect(PayoutProviderReadinessResponse.safeParse(undefined).success).toBe(false);
  });
});
