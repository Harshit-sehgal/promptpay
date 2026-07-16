import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { PayoutMethodTrait } from './payout-method.trait';
import { StripeConnectPayoutProvider } from './providers';

class TestablePayoutMethodTrait extends PayoutMethodTrait {
  constructor(
    public providers: Record<string, unknown>,
    public prisma: unknown,
    public audit: unknown,
    public config: unknown,
    public runtimeConfig: unknown,
  ) {
    super();
  }
}

function makeTrait(
  overrides: {
    createConnectAccount?: () => Promise<{ accountId: string }>;
    createOnboardingLink?: () => Promise<{ url: string }>;
    readiness?: () => { ok: true } | { ok: false; reason: string };
    isProviderEnabled?: boolean;
    launchStatus?: 'available' | 'coming_soon';
    returnDomains?: string;
  } = {},
) {
  const provider = {
    readiness: vi.fn().mockReturnValue({ ok: true }),
    createConnectAccount: vi.fn().mockResolvedValue({ accountId: 'acct_test_123' }),
    createOnboardingLink: vi
      .fn()
      .mockResolvedValue({ url: 'https://connect.stripe.com/onboarding/test' }),
    ...overrides,
  } as unknown as StripeConnectPayoutProvider;

  const prisma = {
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        payoutAccount: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'pa-1' }),
        },
      }),
    ),
  };

  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'WAITLAYER_STRIPE_CONNECT_RETURN_DOMAINS')
        return overrides.returnDomains ?? 'app.waitlayer.com';
      if (key === 'WAITLAYER_PAYOUT_PROVIDER_STATUS') {
        return JSON.stringify({ stripe_connect: overrides.launchStatus ?? 'available' });
      }
      return undefined;
    }),
  };
  const runtimeConfig = {
    isProviderEnabled: vi.fn().mockResolvedValue(overrides.isProviderEnabled ?? true),
  };

  const trait = new TestablePayoutMethodTrait(
    { stripe_connect: provider },
    prisma as never,
    audit as never,
    config as never,
    runtimeConfig as never,
  );

  return { trait, provider, prisma, audit, runtimeConfig };
}

describe('PayoutMethodTrait.createStripeConnectOnboarding', () => {
  it('creates a Stripe Connect account and returns an onboarding URL', async () => {
    const { trait } = makeTrait();

    const result = await trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
      returnUrl: 'https://app.waitlayer.com/onboarding/return',
    });

    expect(result.accountId).toBe('acct_test_123');
    expect(result.onboardingUrl).toBe('https://connect.stripe.com/onboarding/test');
  });

  it('persists a pending payout account', async () => {
    const { trait, prisma } = makeTrait();

    await trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
      returnUrl: 'https://app.waitlayer.com/onboarding/return',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects when Stripe Connect provider is not configured', async () => {
    const trait = new TestablePayoutMethodTrait(
      {},
      {},
      {},
      {
        get: vi.fn((key: string) => {
          if (key === 'WAITLAYER_PAYOUT_PROVIDER_STATUS') {
            return JSON.stringify({ stripe_connect: 'available' });
          }
          return undefined;
        }),
      },
      { isProviderEnabled: vi.fn().mockResolvedValue(true) },
    );

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when Stripe Connect provider is not ready', async () => {
    const { trait } = makeTrait({
      readiness: () => ({ ok: false, reason: 'Stripe not configured' }),
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow('Stripe not configured');
  });

  it('rejects when provider is disabled by runtime kill switch', async () => {
    const { trait } = makeTrait({ isProviderEnabled: false });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow(/currently disabled/i);
  });

  it('rejects when return URL host is not in allowlist', async () => {
    const { trait } = makeTrait({ returnDomains: 'app.waitlayer.com' });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://evil.com/return',
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects when Stripe API throws', async () => {
    const { trait } = makeTrait({
      createConnectAccount: () => Promise.reject(new Error('Stripe API error')),
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow(/Stripe API error/i);
  });
});
