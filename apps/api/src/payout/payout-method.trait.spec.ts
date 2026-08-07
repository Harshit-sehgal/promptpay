import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

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
      ['dodo_payments', 'dodo@gated.dev'],
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
    it('returns only the masked public account shape, never storage ciphertext or HMAC', async () => {
      const now = new Date('2026-08-07T00:00:00.000Z');
      const { service } = makePayoutService({
        payoutRequest: { count: async () => 0 },
        payoutAccount: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 0 }),
          create: async ({ data }: { data: Record<string, unknown> }) => ({
            ...data,
            provider: 'paypal_email',
            currency: 'USD',
            isVerified: false,
            isActive: true,
            isFrozen: false,
            initiationPayoutId: null,
            createdAt: now,
            updatedAt: now,
          }),
        },
      });

      const result = await service.addPayoutMethod('u1', {
        provider: 'paypal_email',
        destination: 'developer@example.com',
        currency: 'USD',
      });

      expect(result).toMatchObject({
        provider: 'paypal_email',
        destination: 'dev***@example.com',
        currency: 'USD',
      });
      expect(result).not.toHaveProperty('userId');
      expect(result).not.toHaveProperty('destinationHmac');
      expect(result.destination).not.toMatch(/^v[12]:/);
    });

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

    it('refuses to replace an operator-frozen active destination', async () => {
      const { service } = makePayoutService({
        payoutRequest: { count: async () => 0 },
        payoutAccount: {
          findFirst: async () => ({
            id: 'pa-frozen',
            isFrozen: true,
            initiationPayoutId: null,
          }),
          updateMany: async () => {
            throw new Error('must not mutate');
          },
        },
      });

      await expect(
        service.addPayoutMethod('u1', {
          provider: 'paypal_email',
          destination: 'new@example.com',
          currency: 'USD',
        }),
      ).rejects.toThrow(/frozen by an operator/i);
    });

    it('refuses replacement while provider initiation awaits reconciliation', async () => {
      const { service } = makePayoutService({
        payoutRequest: { count: async () => 0 },
        payoutAccount: {
          findFirst: async () => ({
            id: 'pa-fenced',
            isFrozen: false,
            initiationPayoutId: 'payout-1',
          }),
          updateMany: async () => {
            throw new Error('must not mutate');
          },
        },
      });

      await expect(
        service.addPayoutMethod('u1', {
          provider: 'paypal_email',
          destination: 'new@example.com',
          currency: 'USD',
        }),
      ).rejects.toThrow(/awaiting reconciliation/i);
    });
  });

  describe('removePayoutMethod', () => {
    it('deactivates only the owned active account and writes the audit in the transaction', async () => {
      const { service, prisma, audit } = makePayoutService({
        payoutRequest: { count: async () => 0 },
        payoutAccount: {
          findUnique: async () => ({
            id: 'pa-1',
            userId: 'u1',
            provider: 'paypal_email',
            currency: 'USD',
            isActive: true,
            isFrozen: false,
            initiationPayoutId: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
      });

      await expect(service.removePayoutMethod('u1', 'pa-1')).resolves.toEqual({
        removed: true,
      });
      expect(audit.logStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'remove_payout_method',
          targetId: 'pa-1',
        }),
        prisma,
      );
    });

    it('does not reveal or alter an account owned by another user', async () => {
      const { service } = makePayoutService({
        payoutRequest: { count: async () => 0 },
        payoutAccount: {
          findUnique: async () => ({
            id: 'pa-1',
            userId: 'other-user',
            provider: 'paypal_email',
            currency: 'USD',
            isActive: true,
            isFrozen: false,
            initiationPayoutId: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
      });

      await expect(service.removePayoutMethod('u1', 'pa-1')).rejects.toThrow(NotFoundException);
    });

    it('refuses removal while a payout is reserved or provider initiation is fenced', async () => {
      const { service } = makePayoutService({
        payoutRequest: { count: async () => 1 },
        payoutAccount: {
          findUnique: async () => ({
            id: 'pa-1',
            userId: 'u1',
            provider: 'paypal_email',
            currency: 'USD',
            isActive: true,
            isFrozen: false,
            initiationPayoutId: 'payout-1',
          }),
          updateMany: async () => ({ count: 1 }),
        },
      });

      await expect(service.removePayoutMethod('u1', 'pa-1')).rejects.toThrow(ConflictException);
    });

    it('refuses removal of an operator-frozen method', async () => {
      const { service } = makePayoutService({
        payoutRequest: { count: async () => 0 },
        payoutAccount: {
          findUnique: async () => ({
            id: 'pa-1',
            userId: 'u1',
            provider: 'paypal_email',
            currency: 'USD',
            isActive: true,
            isFrozen: true,
            initiationPayoutId: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
      });

      await expect(service.removePayoutMethod('u1', 'pa-1')).rejects.toThrow(
        /frozen by an operator/i,
      );
    });
  });
});
