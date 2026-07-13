import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import { privacyPseudonym } from '../../common/utils/privacy-hash';
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
          return new Response(
            JSON.stringify({
              batch_header: { payout_batch_id: 'paypal_batch_123', batch_status: 'PENDING' },
            }),
            { status: 200 },
          );
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

      expect(res).toEqual({ providerTxId: 'paypal_batch_123', status: 'processing' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const logText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logText).toContain('PayPal payout initiated: paypal_batch_123 for recipient');
      expect(logText).not.toContain('dev@example.com');
      expect(logText).toContain(
        privacyPseudonym('dev@example.com', 'paypal-payout-destination').slice(0, 12),
      );
      expect(logText).not.toContain(
        createHash('sha256').update('dev@example.com').digest('hex').slice(0, 8),
      );
    });

    it('fails closed when PayPal omits the authoritative batch id', async () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
              status: 200,
            }),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 })),
      );

      await expect(
        p.initiate({
          payoutRequestId: 'req_missing_batch',
          destination: 'dev@example.com',
          amountMinor: 2500n,
          currency: 'USD',
        }),
      ).rejects.toMatchObject({ name: 'PayoutProviderUnsafeFailure' });
    });

    it('rejects an amount above the exact JavaScript/provider boundary', async () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        p.initiate({
          payoutRequestId: 'req_huge',
          destination: 'dev@example.com',
          amountMinor: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          currency: 'USD',
        }),
      ).rejects.toThrow(/maximum safely supported/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('distinguishes definitive 4xx rejection from ambiguous throttling/server failure', async () => {
      const run = async (status: number) => {
        const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockResolvedValueOnce(
              new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
                status: 200,
              }),
            )
            .mockResolvedValueOnce(
              new Response(JSON.stringify({ message: 'dev@example.com invalid' }), { status }),
            ),
        );
        return p.initiate({
          payoutRequestId: `req_${status}`,
          destination: 'dev@example.com',
          amountMinor: 2500n,
          currency: 'USD',
        });
      };

      await expect(run(400)).resolves.toMatchObject({ status: 'failed' });
      await expect(run(429)).rejects.toMatchObject({ name: 'PayoutProviderUnsafeFailure' });
      await expect(run(500)).rejects.toMatchObject({ name: 'PayoutProviderUnsafeFailure' });
    });
  });

  describe('checkStatus', () => {
    it('polls the authoritative batch endpoint and maps SUCCESS', async () => {
      const p = makeProvider({ clientId: 'id', clientSecret: 'secret' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              batch_header: {
                batch_status: 'SUCCESS',
                time_completed: '2026-01-01T00:00:00.000Z',
              },
            }),
            { status: 200 },
          ),
        );
      vi.stubGlobal('fetch', fetchMock);

      await expect(p.checkStatus('PBATCH-1')).resolves.toEqual({
        status: 'paid',
        paidAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(String(fetchMock.mock.calls[1][0])).toContain('/v1/payments/payouts/PBATCH-1?');
      expect(String(fetchMock.mock.calls[1][0])).not.toContain('payouts-item');
    });
  });
});
