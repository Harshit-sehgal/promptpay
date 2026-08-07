import { describe, expect, it, vi } from 'vitest';

import { PayoutProviderReadinessResponse } from '@waitlayer/shared';

import { StubPayoutProvider } from './payout.constants';
import { PayoutMethodTrait } from './payout-method.trait';

class TestablePayoutMethodTrait extends PayoutMethodTrait {
  constructor(
    public providers: Record<string, never>,
    public config: never,
    public runtimeConfig: never,
  ) {
    super();
  }
}

describe('PayoutMethodTrait provider availability', () => {
  it('reports distinct fail-closed states without exposing credential details', async () => {
    const ready = {
      readiness: () => ({ ok: true as const }),
      initiate: vi.fn(),
      checkStatus: vi.fn(),
    };
    const unconfigured = {
      readiness: () => ({
        ok: false as const,
        reason: 'STRIPE_SECRET_KEY=super-sensitive-operator-detail is missing',
      }),
      initiate: vi.fn(),
      checkStatus: vi.fn(),
    };
    const trait = new TestablePayoutMethodTrait(
      {
        paypal_email: ready,
        manual: ready,
        stripe_connect: unconfigured,
        payoneer: new StubPayoutProvider('Payoneer', 'payoneer'),
      } as never,
      {
        get: vi.fn((key: string) =>
          key === 'WAITLAYER_PAYOUT_PROVIDER_STATUS'
            ? JSON.stringify({ stripe_connect: 'available', payoneer: 'available' })
            : undefined,
        ),
      } as never,
      {
        getStringArray: vi.fn().mockResolvedValue(['paypal_email']),
      } as never,
    );

    const response = PayoutProviderReadinessResponse.parse(
      await trait.getPayoutProviderAvailability(),
    );
    const byProvider = Object.fromEntries(
      response.providers.map((provider) => [provider.provider, provider]),
    );

    expect(byProvider.manual).toMatchObject({
      available: true,
      status: 'available',
      reasonCode: null,
      reason: null,
    });
    expect(byProvider.paypal_email).toMatchObject({
      available: false,
      status: 'temporarily_disabled',
      reasonCode: 'operator_disabled',
    });
    expect(byProvider.stripe_connect).toMatchObject({
      available: false,
      status: 'unconfigured',
      reasonCode: 'provider_unconfigured',
    });
    expect(byProvider.payoneer).toMatchObject({
      available: false,
      status: 'unimplemented',
      reasonCode: 'provider_unimplemented',
    });
    expect(byProvider.wise).toMatchObject({
      available: false,
      status: 'coming_soon',
      reasonCode: 'launch_not_available',
    });
    expect(JSON.stringify(response)).not.toContain('STRIPE_SECRET_KEY');
    expect(JSON.stringify(response)).not.toContain('super-sensitive');
  });
});
