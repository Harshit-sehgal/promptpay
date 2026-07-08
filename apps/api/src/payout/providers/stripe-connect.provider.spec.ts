import { beforeEach,describe, expect, it, vi } from 'vitest';

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
function fakeStripe(options: { payoutCreateFails?: boolean; reversalFails?: boolean } = {}) {
  const calls: { args: any; opts: any }[] = [];
  const retrieveCalls: { providerTxId: string; opts: any }[] = [];
  const transferCalls: { args: any; opts: any }[] = [];
  const reversalCalls: { transferId: string; args: any; opts: any }[] = [];
  return {
    calls,
    retrieveCalls,
    transferCalls,
    reversalCalls,
    transfers: {
      create: vi.fn(async (args: any, opts: any) => {
        transferCalls.push({ args, opts });
        return { id: 'tr_test_123' };
      }),
      createReversal: vi.fn(async (transferId: string, args: any, opts: any) => {
        reversalCalls.push({ transferId, args, opts });
        if (options.reversalFails) throw new Error('reversal failed');
        return { id: 'trr_test_123' };
      }),
    },
    payouts: {
      create: vi.fn(async (args: any, opts: any) => {
        calls.push({ args, opts });
        if (options.payoutCreateFails) throw new Error('payout create failed');
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
    it('funds the connected account, creates a payout there, and returns the Stripe payout id', async () => {
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
      const { calls, transferCalls } = (provider as any).stripe as ReturnType<typeof fakeStripe>;
      expect(transferCalls[0].args).toEqual({
        amount: 2500,
        currency: 'usd',
        destination: 'acct_developer123',
        transfer_group: 'wl_payout_req_1',
        metadata: {
          payoutRequestId: 'req_1',
          provider: 'stripe_connect',
          purpose: 'developer_payout_funding',
        },
      });
      expect(transferCalls[0].opts.idempotencyKey).toBe('wl_payout_req_1_transfer');
      expect(calls[0].opts.stripeAccount).toBe('acct_developer123');
      expect(calls[0].opts.idempotencyKey).toBe('wl_payout_req_1_payout');
      expect(calls[0].args.amount).toBe(2500);
      expect(calls[0].args.currency).toBe('usd');
      expect(calls[0].args.metadata.payoutRequestId).toBe('req_1');
      expect(calls[0].args.metadata.transferId).toBe('tr_test_123');
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

    it('reverses the transfer if connected-account payout creation fails', async () => {
      const provider = makeProvider({ secretKey: 'sk_test_xxx' });
      (provider as any).stripe = fakeStripe({ payoutCreateFails: true });

      await expect(
        provider.initiate({
          payoutRequestId: 'req_4',
          destination: 'acct_developer123',
          amountMinor: 2500,
          currency: 'USD',
        }),
      ).rejects.toThrow(/transfer was reversed/);

      const { reversalCalls } = (provider as any).stripe as ReturnType<typeof fakeStripe>;
      expect(reversalCalls[0]).toEqual({
        transferId: 'tr_test_123',
        args: {
          amount: 2500,
          metadata: {
            payoutRequestId: 'req_4',
            provider: 'stripe_connect',
            reason: 'connected_account_payout_create_failed',
          },
        },
        opts: { idempotencyKey: 'wl_payout_req_4_transfer_reversal' },
      });
    });

    it('throws an unsafe failure if payout creation and transfer reversal both fail', async () => {
      const provider = makeProvider({ secretKey: 'sk_test_xxx' });
      (provider as any).stripe = fakeStripe({ payoutCreateFails: true, reversalFails: true });

      await expect(
        provider.initiate({
          payoutRequestId: 'req_5',
          destination: 'acct_developer123',
          amountMinor: 2500,
          currency: 'USD',
        }),
      ).rejects.toThrow(/Do not release payout allocations/);
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
