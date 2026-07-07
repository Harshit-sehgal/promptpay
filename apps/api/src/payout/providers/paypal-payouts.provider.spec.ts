import { Logger } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayPalPayoutsProvider } from './paypal-payouts.provider';

function makeProvider(opts: { clientId?: string; clientSecret?: string; mode?: string; nodeEnv?: string }) {
  const config = {
    get: (key: string, fallback?: string) => {
      switch (key) {
        case 'PAYPAL_CLIENT_ID':
          return opts.clientId ?? '';
        case 'PAYPAL_CLIENT_SECRET':
          return opts.clientSecret ?? '';
        case 'PAYPAL_MODE':
          return opts.mode ?? 'sandbox';
        case 'NODE_ENV':
          return opts.nodeEnv ?? fallback ?? 'development';
        default:
          return fallback;
      }
    },
  } as any;
  return new PayPalPayoutsProvider(config);
}

describe('PayPalPayoutsProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('readiness', () => {
    it('is ready when client credentials are configured', () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      expect(p.readiness()).toEqual({ ok: true });
    });

    it('fails closed in production without credentials', () => {
      const p = makeProvider({ nodeEnv: 'production' });
      expect(p.readiness().ok).toBe(false);
    });
  });

  describe('initiate', () => {
    it('returns a stub response in dev when not configured', async () => {
      const p = makeProvider({});
      const res = await p.initiate({
        payoutRequestId: 'req_1',
        destination: 'dev@example.com',
        amountMinor: 2500,
        currency: 'USD',
      });
      expect(res.providerTxId).toMatch(/^dev_stub_paypal_/);
    });

    it('refuses an invalid email destination before calling PayPal', async () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        p.initiate({
          payoutRequestId: 'req_2',
          destination: 'not-an-email',
          amountMinor: 2500,
          currency: 'USD',
        }),
      ).rejects.toThrow(/recipient email/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a non-positive amount before calling PayPal', async () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        p.initiate({
          payoutRequestId: 'req_3',
          destination: 'dev@example.com',
          amountMinor: 0,
          currency: 'USD',
        }),
      ).rejects.toThrow(/non-positive amount/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('creates a payout while logging only a hashed recipient reference', async () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const fetchMock = vi.fn(async (url: string, init: any) => {
        if (url.includes('/v1/oauth2/token')) {
          return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), { status: 200 });
        }
        if (url.includes('/v1/payments/payouts')) {
          const body = JSON.parse(init.body);
          expect(body.items[0].receiver).toBe('dev@example.com');
          return new Response(JSON.stringify({ items: [{ payout_item_id: 'paypal_item_123' }] }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await p.initiate({
        payoutRequestId: 'req_4',
        destination: ' dev@example.com ',
        amountMinor: 2500,
        currency: 'USD',
      });

      expect(res).toEqual({ providerTxId: 'paypal_item_123', status: 'processing' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const logText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logText).toContain('PayPal payout initiated: paypal_item_123 for recipient');
      expect(logText).not.toContain('dev@example.com');
    });
  });
});
