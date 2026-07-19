import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { makePayoutService } from './test/payout-test-helper';

/**
 * P1.9 — Pin the payout-method registration guard that rejects gated
 * (`coming_soon`) and unimplemented (StubPayoutProvider) providers so they can
 * never be persisted as a payout account in the sandbox. Only the local,
 * in-memory providers (paypal_email, manual) are registerable; everything that
 * would require a real outbound PSP call is rejected at registration time,
 * which is what keeps the sandbox run free of external network egress.
 */
describe('PayoutMethodTrait registration guard (sandbox)', () => {
  const { service } = makePayoutService();

  describe('normalizePayoutMethod rejects gated / unimplemented providers', () => {
    it.each([
      // Stub providers — implemented only as a throwing stub, must not register.
      ['payoneer', 'payoneer@gated.dev'],
      ['razorpay', 'razorpay@gated.dev'],
      // coming_soon providers with a real (but unlaunched) handler.
      ['paypal_payouts', 'pp_payouts@gated.dev'],
      ['stripe_connect', 'acct_gated_123'],
      ['wise', 'wise@gated.dev'],
    ])('rejects %s (not registerable in sandbox)', async (provider, destination) => {
      await expect(
        service.normalizePayoutMethod({ provider, destination, currency: 'USD' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('normalizePayoutMethod accepts the local in-memory providers', () => {
    it('accepts paypal_email with a recipient email', async () => {
      const res = await service.normalizePayoutMethod({
        provider: 'paypal_email',
        destination: 'dev@example.com',
        currency: 'USD',
      });
      expect(res.provider).toBe('paypal_email');
      expect(res.currency).toBe('USD');
      expect(res.destination).toBe('dev@example.com');
    });

    it('accepts manual with any non-empty destination', async () => {
      const res = await service.normalizePayoutMethod({
        provider: 'manual',
        destination: 'manual-dest-wallet-001',
        currency: 'USD',
      });
      expect(res.provider).toBe('manual');
      expect(res.currency).toBe('USD');
    });
  });

  describe('addPayoutMethod enforces the guard on the public entrypoint', () => {
    it('rejects a stub / coming_soon provider before any persistence', async () => {
      await expect(
        service.addPayoutMethod('u1', {
          provider: 'payoneer',
          destination: 'payoneer@gated.dev',
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a coming_soon provider (wise) before any persistence', async () => {
      await expect(
        service.addPayoutMethod('u1', {
          provider: 'wise',
          destination: 'wise@gated.dev',
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
