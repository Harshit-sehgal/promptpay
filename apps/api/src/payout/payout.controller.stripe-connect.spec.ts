import { describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../config/prisma.service';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';

describe('PayoutController Stripe Connect onboarding', () => {
  async function setup() {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayoutController],
      providers: [
        {
          provide: AuditService,
          useValue: { log: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: PayoutService,
          useValue: {
            createStripeConnectOnboarding: vi.fn().mockResolvedValue({
              accountId: 'acct_test_123',
              onboardingUrl: 'https://connect.stripe.com/onboarding/test',
            }),
            getPayoutProviderAvailability: vi.fn(),
            addPayoutMethod: vi.fn(),
            getPayoutInfo: vi.fn(),
            requestPayout: vi.fn(),
            getAvailableForPayout: vi.fn(),
            getPayoutHistory: vi.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ActionStepUpGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const controller = module.get<PayoutController>(PayoutController);
    const service = module.get<PayoutService>(PayoutService);
    return { controller, service };
  }

  it('creates a Stripe Connect onboarding URL', async () => {
    const { controller, service } = await setup();

    const result = await controller.createStripeConnectOnboarding('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/refresh',
      returnUrl: 'https://app.waitlayer.com/return',
      currency: 'USD',
    });

    expect(result).toEqual({
      accountId: 'acct_test_123',
      onboardingUrl: 'https://connect.stripe.com/onboarding/test',
    });
    expect(service.createStripeConnectOnboarding).toHaveBeenCalledWith('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/refresh',
      returnUrl: 'https://app.waitlayer.com/return',
      currency: 'USD',
    });
  });

  it('defaults currency to undefined when not provided', async () => {
    const { controller, service } = await setup();

    await controller.createStripeConnectOnboarding('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/refresh',
      returnUrl: 'https://app.waitlayer.com/return',
    });

    expect(service.createStripeConnectOnboarding).toHaveBeenCalledWith('u1', 'dev@example.com', {
      refreshUrl: 'https://app.waitlayer.com/refresh',
      returnUrl: 'https://app.waitlayer.com/return',
      currency: undefined,
    });
  });
});
