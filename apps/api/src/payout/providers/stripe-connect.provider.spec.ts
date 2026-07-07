import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeConnectPayoutProvider } from './stripe.provider';

function makeProvider(opts: { secretKey?: string; nodeEnv?: string }) {
  const config = {
    get: (key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return opts.secretKey ?? '';
      if (key === 'NODE_ENV') return opts.nodeEnv ?? 'development';
      return undefined;
    },
  } as any;
  return new StripeConnectPayoutProvider(config);
}

// Minimal Stripe SDK double that records the `stripeAccount` header used.
function fakeStripe() {
  const calls: { args: any; opts: any }[] = [];
  const retrieveCalls: { providerTxId: string; opts: any }[] = [];
  return {
    calls,
    retrieveCalls,
    payouts: {
      create: vi.fn(async (args: any, opts: any) => {
        calls.push({ args, opts });
        return { id: 'po_test_123', status: 'pending' };
      }),
      retrieve: vi.fn(async (providerTxId: string, _params: any, opts: any) => {
        retrieveCalls.push({ providerTxId, opts });
        return { id: providerTxId, status: 'paid', arrival_date: 1700000000 };
      }),
    },
  };
}

describe('StripeConnectPayoutProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('readiness', () => {
    it('is ready when a secret key is configured', () => {
      const p = makeProvider({ secretKey: 'sk_test_xxx' });
      expect(p.readiness()).toEqual({ ok: true });
    });

    it('fails closed in production when Stripe is not configured', () => {
      const p = makeProvider({ secretKey: '', nodeEnv: 'production' });
      const r = p.readiness();
      expect(r.ok).toBe(false);
    });

    it('reports disabled (non-ok) in dev when Stripe is not configured', () => {
      const p = makeProvider({ secretKey: '' });
      expect(p.readiness().ok).toBe(false);
    });
  });

  describe('initiate', () => {
    it('creates a payout on the developer connected account and returns the Stripe payout id', async () => {
      const provider = makeProvider({ secretKey: 'sk_test_xxx' });
      // Inject the fake Stripe client.
      (provider as any).stripe = fakeStripe();

      const res = await provider.initiate({
        payoutRequestId: 'req_1',
        destination: 'acct_developer123',
        amountMinor: 2500,
        currency: 'USD',
      });

      expect(res.providerTxId).toBe('po_test_123');
      const { calls } = (provider as any).stripe as ReturnType<typeof fakeStripe>;
      expect(calls[0].opts.stripeAccount).toBe('acct_developer123');
      expect(calls[0].args.amount).toBe(2500);
      expect(calls[0].args.currency).toBe('usd');
      expect(calls[0].args.metadata.payoutRequestId).toBe('req_1');
    });

    it('refuses a non-acct_ destination so production money never goes to an unknown account', async () => {
      const provider = makeProvider({ secretKey: 'sk_test_xxx' });
      (provider as any).stripe = fakeStripe();

      await expect(
        provider.initiate({
          payoutRequestId: 'req_2',
          destination: 'dev@example.com',
          amountMinor: 2500,
          currency: 'USD',
        }),
      ).rejects.toThrow(/connected account id/);
    });

    it('refuses a non-positive amount', async () => {
      const provider = makeProvider({ secretKey: 'sk_test_xxx' });
      (provider as any).stripe = fakeStripe();

      await expect(
        provider.initiate({
          payoutRequestId: 'req_3',
          destination: 'acct_dev',
          amountMinor: 0,
          currency: 'USD',
        }),
      ).rejects.toThrow(/non-positive amount/);
    });
  });

  describe('checkStatus', () => {
    it('retrieves the payout and maps arrival_date to paidAt', async () => {
      const provider = makeProvider({ secretKey: 'sk_test_xxx' });
      (provider as any).stripe = fakeStripe();

      const res = await provider.checkStatus('po_test_123', { destination: 'acct_developer123' });
      expect(res.status).toBe('paid');
      expect(res.paidAt).toEqual(new Date(1700000000 * 1000));
      const { retrieveCalls } = (provider as any).stripe as ReturnType<typeof fakeStripe>;
      expect(retrieveCalls[0]).toEqual({
        providerTxId: 'po_test_123',
        opts: { stripeAccount: 'acct_developer123' },
      });
    });
  });
});
