import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';

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
    nodeEnv?: string;
    webBaseUrl?: string;
    activeAccount?: {
      id: string;
      userId: string;
      provider: 'stripe_connect';
      destination: string;
      currency: string;
      isFrozen: boolean;
      initiationPayoutId: string | null;
    } | null;
    inFlightCount?: number;
    createDb?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const provider = {
    readiness: vi.fn().mockReturnValue({ ok: true }),
    createConnectAccount: vi.fn().mockResolvedValue({ accountId: 'acct_test_123' }),
    createOnboardingLink: vi
      .fn()
      .mockResolvedValue({ url: 'https://connect.stripe.com/onboarding/test' }),
  } as unknown as StripeConnectPayoutProvider;
  if (overrides.createConnectAccount) {
    provider.createConnectAccount = vi.fn(overrides.createConnectAccount);
  }
  if (overrides.createOnboardingLink) {
    provider.createOnboardingLink = vi.fn(overrides.createOnboardingLink);
  }
  if (overrides.readiness) {
    provider.readiness = vi.fn(overrides.readiness);
  }

  const payoutAccount = {
    findFirst: vi.fn().mockResolvedValue(overrides.activeAccount ?? null),
    create:
      overrides.createDb ??
      vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: data.id }),
        ),
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    payoutAccount,
    payoutRequest: {
      count: vi.fn().mockResolvedValue(overrides.inFlightCount ?? 0),
    },
  };
  const prisma = {
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  };

  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
    logStrict: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'WAITLAYER_STRIPE_CONNECT_RETURN_DOMAINS')
        return overrides.returnDomains ?? 'app.waitlayer.com';
      if (key === 'NODE_ENV') return overrides.nodeEnv;
      if (key === 'WEB_BASE_URL') return overrides.webBaseUrl;
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

  return { trait, provider, prisma, audit, runtimeConfig, tx, payoutAccount };
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
    const { trait, prisma, payoutAccount } = makeTrait();

    await trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
      returnUrl: 'https://app.waitlayer.com/onboarding/return',
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(payoutAccount.create).toHaveBeenCalledTimes(1);
  });

  it('reuses a durable pending account instead of creating another remote account', async () => {
    const { trait, provider, payoutAccount } = makeTrait({
      activeAccount: {
        id: 'pa-existing',
        userId: 'u1',
        provider: 'stripe_connect',
        destination: 'acct_existing',
        currency: 'USD',
        isFrozen: false,
        initiationPayoutId: null,
      },
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).resolves.toMatchObject({ accountId: 'acct_existing' });

    expect(provider.createConnectAccount).not.toHaveBeenCalled();
    expect(payoutAccount.create).not.toHaveBeenCalled();
    expect(provider.createOnboardingLink).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct_existing' }),
    );
  });

  it('refuses to replace an operator-frozen Stripe account', async () => {
    const { trait, provider } = makeTrait({
      activeAccount: {
        id: 'pa-frozen',
        userId: 'u1',
        provider: 'stripe_connect',
        destination: 'acct_frozen',
        currency: 'USD',
        isFrozen: true,
        initiationPayoutId: null,
      },
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow(ConflictException);
    expect(provider.createConnectAccount).not.toHaveBeenCalled();
  });

  it('refuses onboarding while the active Stripe account has a reserved payout', async () => {
    const { trait, provider } = makeTrait({
      activeAccount: {
        id: 'pa-busy',
        userId: 'u1',
        provider: 'stripe_connect',
        destination: 'acct_busy',
        currency: 'USD',
        isFrozen: false,
        initiationPayoutId: null,
      },
      inFlightCount: 1,
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow(/still in progress/i);
    expect(provider.createConnectAccount).not.toHaveBeenCalled();
  });

  it('persists the account before creating the short-lived onboarding link', async () => {
    const order: string[] = [];
    const { trait, payoutAccount } = makeTrait({
      createOnboardingLink: async () => {
        order.push('link');
        throw new Error('link failed');
      },
      createDb: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        order.push('persist');
        return { id: data.id };
      }),
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return',
      }),
    ).rejects.toThrow(/link failed/i);
    expect(payoutAccount.create).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['persist', 'link']);
  });

  it('binds production onboarding redirects to the configured HTTPS web origin', async () => {
    const { trait } = makeTrait({
      nodeEnv: 'production',
      webBaseUrl: 'https://app.waitlayer.com',
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://evil.example/onboarding/return',
      }),
    ).rejects.toThrow('configured production web origin');
  });

  it('accepts production onboarding redirects on the configured HTTPS web origin', async () => {
    const { trait } = makeTrait({
      nodeEnv: 'production',
      webBaseUrl: 'https://app.waitlayer.com',
    });

    await expect(
      trait.createStripeConnectOnboarding('u1', 'dev@example.com', {
        refreshUrl: 'https://app.waitlayer.com/onboarding/refresh',
        returnUrl: 'https://app.waitlayer.com/onboarding/return?connected=1',
      }),
    ).resolves.toMatchObject({ accountId: 'acct_test_123' });
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
