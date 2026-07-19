import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { StripeConnectPayoutProvider, StripeProvider } from './stripe.provider';

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const full: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_xxx',
    NODE_ENV: 'development',
    ...overrides,
  };
  return {
    get: (key: string) => full[key],
  } as unknown as ConfigService;
}

type MockStripe = {
  checkout: { sessions: { create: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> } };
  webhooks: { constructEvent: ReturnType<typeof vi.fn> };
  accounts: { retrieve: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  accountLinks: { create: ReturnType<typeof vi.fn> };
  transfers: { create: ReturnType<typeof vi.fn>; createReversal: ReturnType<typeof vi.fn> };
  payouts: { create: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> };
};

function makeMockStripe(status = 'paid'): MockStripe {
  return {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://stripe.com/cs_1' }),
        retrieve: vi.fn().mockResolvedValue({
          id: 'cs_1',
          metadata: { advertiserId: 'adv-1' },
          amount_total: 1000,
          currency: 'usd',
          payment_intent: 'pi_1',
          customer: 'cus_1',
        }),
      },
    },
    webhooks: { constructEvent: vi.fn().mockReturnValue({ id: 'evt_1', type: 'x' }) },
    accounts: {
      retrieve: vi.fn().mockResolvedValue({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
      create: vi.fn().mockResolvedValue({ id: 'acct_1' }),
    },
    accountLinks: {
      create: vi.fn().mockResolvedValue({ url: 'https://stripe.com/onboard' }),
    },
    transfers: {
      create: vi.fn().mockResolvedValue({ id: 'tr_1' }),
      createReversal: vi.fn().mockResolvedValue({ id: 'trr_1' }),
    },
    payouts: {
      create: vi.fn().mockResolvedValue({ id: 'po_1', status: 'paid' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'po_1', status, arrival_date: 1700000000 }),
    },
  };
}

function injectStripe(provider: unknown, mock: MockStripe): void {
  (provider as unknown as { stripe: Stripe }).stripe = mock as unknown as Stripe;
}

describe('StripeProvider (deposit) enabled paths', () => {
  it('reports enabled when a secret key is configured', () => {
    const provider = new StripeProvider(makeConfig());
    expect(provider.isEnabled()).toBe(true);
  });

  it('creates a checkout session and returns its id + url', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const res = await provider.createDepositSession({
      advertiserId: 'adv-1',
      amountMinor: 1000n,
      currency: 'USD',
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });

    expect(res).toEqual({ sessionId: 'cs_1', url: 'https://stripe.com/cs_1' });
    expect(mock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'payment' }),
      undefined,
    );
  });

  it('verifies a webhook signature and returns the parsed event', () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const event = provider.verifyWebhookSignature('payload', 'sig');
    expect(event).toEqual({ id: 'evt_1', type: 'x' });
    expect(mock.webhooks.constructEvent).toHaveBeenCalledWith('payload', 'sig', 'whsec_xxx');
  });

  it('throws a clear error when the webhook secret is missing (fail-closed)', () => {
    const provider = new StripeProvider(makeConfig({ STRIPE_WEBHOOK_SECRET: '' }));
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    expect(() => provider.verifyWebhookSignature('payload', 'sig')).toThrow(
      /STRIPE_WEBHOOK_SECRET is not configured/,
    );
  });

  it('retrieves a connected account verification state', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const v = await provider.retrieveConnectAccountVerification('acct_1');
    expect(v).toEqual({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    expect(mock.accounts.retrieve).toHaveBeenCalledWith('acct_1');
  });

  it('throws when the connected account id is malformed', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    await expect(provider.retrieveConnectAccountVerification('not_an_acct')).rejects.toThrow(
      /Invalid Stripe Connect account id/,
    );
  });

  it('maps a completed checkout session to payment details', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const details = await provider.handleCheckoutComplete('cs_1');
    expect(details).toEqual({
      advertiserId: 'adv-1',
      amountMinor: 1000,
      currency: 'usd',
      paymentIntentId: 'pi_1',
      stripeCustomerId: 'cus_1',
    });
  });

  it('maps refund details, preferring the explicit payment_intent id', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const refund = {
      payment_intent: 'pi_refund',
      amount: 500,
      currency: 'usd',
    } as Stripe.Refund;
    const details = await provider.getRefundDetails(refund);
    expect(details).toEqual({ paymentIntentId: 'pi_refund', amountMinor: 500, currency: 'usd' });
  });

  it('falls back to an empty payment_intent id when the refund omits it', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const refund = { amount: 500, currency: 'usd' } as unknown as Stripe.Refund;
    const details = await provider.getRefundDetails(refund);
    expect(details.paymentIntentId).toBe('');
  });

  it('maps dispute details including reason and status', async () => {
    const provider = new StripeProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const dispute = {
      payment_intent: 'pi_dispute',
      amount: 700,
      currency: 'usd',
      reason: 'fraudulent',
      status: 'needs_response',
    } as Stripe.Dispute;
    const details = await provider.getDisputeDetails(dispute);
    expect(details).toEqual({
      paymentIntentId: 'pi_dispute',
      amountMinor: 700,
      currency: 'usd',
      reason: 'fraudulent',
      status: 'needs_response',
    });
  });
});

describe('StripeProvider (deposit) not-configured fail-closed', () => {
  it('is disabled without a secret key', () => {
    const provider = new StripeProvider(makeConfig({ STRIPE_SECRET_KEY: '' }));
    expect(provider.isEnabled()).toBe(false);
  });

  it('verifyWebhookSignature throws synchronously when Stripe is not configured', () => {
    const provider = new StripeProvider(makeConfig({ STRIPE_SECRET_KEY: '' }));
    expect(() => provider.verifyWebhookSignature('payload', 'sig')).toThrow(
      /Stripe is not configured/,
    );
  });

  it.each([
    'createDepositSession',
    'retrieveConnectAccountVerification',
    'handleCheckoutComplete',
    'getRefundDetails',
    'getDisputeDetails',
  ] as const)('throws when Stripe is not configured (%s)', async (method) => {
    const provider = new StripeProvider(makeConfig({ STRIPE_SECRET_KEY: '' }));
    const call = () => {
      switch (method) {
        case 'createDepositSession':
          return provider.createDepositSession({
            advertiserId: 'a',
            amountMinor: 1n,
            currency: 'USD',
            successUrl: 's',
            cancelUrl: 'c',
          });
        case 'retrieveConnectAccountVerification':
          return provider.retrieveConnectAccountVerification('acct_1') as unknown;
        case 'handleCheckoutComplete':
          return provider.handleCheckoutComplete('cs_1') as unknown;
        case 'getRefundDetails':
          return provider.getRefundDetails({} as Stripe.Refund) as unknown;
        case 'getDisputeDetails':
          return provider.getDisputeDetails({} as Stripe.Dispute) as unknown;
      }
    };
    await expect(call()).rejects.toThrow(/Stripe is not configured/);
  });
});

describe('StripeConnectPayoutProvider onboarding + status', () => {
  it('creates a connected Express account and returns its id', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const res = await provider.createConnectAccount({ userId: 'u1', email: 'd@x.io' });
    expect(res).toEqual({ accountId: 'acct_1' });
    expect(mock.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'express', email: 'd@x.io' }),
    );
  });

  it('creates an onboarding link and returns its url', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe();
    injectStripe(provider, mock);

    const res = await provider.createOnboardingLink({
      accountId: 'acct_1',
      refreshUrl: 'r',
      returnUrl: 'ret',
    });
    expect(res).toEqual({ url: 'https://stripe.com/onboard' });
  });

  it('throws when Stripe returns no onboarding url', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe();
    mock.accountLinks.create = vi.fn().mockResolvedValue({}) as never;
    injectStripe(provider, mock);

    await expect(
      provider.createOnboardingLink({ accountId: 'acct_1', refreshUrl: 'r', returnUrl: 'ret' }),
    ).rejects.toThrow(/did not return an onboarding URL/);
  });

  it('maps a paid payout status and arrival date', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe('paid');
    injectStripe(provider, mock);

    const res = await provider.checkStatus('po_1', { destination: 'acct_1' });
    expect(res.status).toBe('paid');
    expect(res.paidAt).toBeInstanceOf(Date);
  });

  it('maps a failed/canceled payout status to requires_review', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe('failed');
    injectStripe(provider, mock);

    const res = await provider.checkStatus('po_1', { destination: 'acct_1' });
    expect(res.status).toBe('requires_review');
  });

  it('maps an in-flight payout status to processing', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe('in_transit');
    injectStripe(provider, mock);

    const res = await provider.checkStatus('po_1', { destination: 'acct_1' });
    expect(res.status).toBe('processing');
  });

  it('throws when the status destination is not a connected account id', async () => {
    const provider = new StripeConnectPayoutProvider(makeConfig());
    const mock = makeMockStripe('paid');
    injectStripe(provider, mock);

    await expect(provider.checkStatus('po_1', { destination: 'not_acct' })).rejects.toThrow(
      /connected account id/,
    );
  });
});
