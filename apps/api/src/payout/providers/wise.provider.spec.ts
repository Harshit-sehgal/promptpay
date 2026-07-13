import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import { privacyPseudonym } from '../../common/utils/privacy-hash';
import { WisePayoutProvider } from './wise.provider';

function makeProvider(opts: {
  token?: string;
  profileId?: string;
  mode?: string;
  nodeEnv?: string;
  emailRecipientsVerified?: boolean;
}) {
  const config = {
    get: (key: string) => {
      switch (key) {
        case 'WISE_API_TOKEN':
          return opts.token ?? '';
        case 'WISE_PROFILE_ID':
          return opts.profileId ?? '';
        case 'WISE_EMAIL_RECIPIENTS_VERIFIED':
          return opts.emailRecipientsVerified === false ? 'false' : 'true';
        case 'WISE_MODE':
          return opts.mode ?? 'sandbox';
        case 'NODE_ENV':
          return opts.nodeEnv ?? 'development';
        default:
          return undefined;
      }
    },
  } as any;
  return new WisePayoutProvider(config);
}

describe('WisePayoutProvider', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('readiness', () => {
    it('is ready when token + profile id are configured', () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      expect(p.readiness()).toEqual({ ok: true });
    });

    it('fails closed in production without credentials', () => {
      const p = makeProvider({ nodeEnv: 'production' });
      expect(p.readiness().ok).toBe(false);
    });

    it('fails closed until the account-specific email corridor is verified', () => {
      const p = makeProvider({
        token: 'tok',
        profileId: '123',
        emailRecipientsVerified: false,
      });
      expect(p.readiness()).toEqual(
        expect.objectContaining({ ok: false, reason: expect.stringContaining('not verified') }),
      );
    });
  });

  describe('initiate', () => {
    it('returns a stub response in dev when not configured (no real money moved)', async () => {
      const p = makeProvider({});
      const res = await p.initiate({
        payoutRequestId: 'req_1',
        destination: 'dev@example.com',
        amountMinor: 2500,
        currency: 'USD',
      });
      expect(res.providerTxId).toMatch(/^dev_stub_wise_/);
    });

    it('refuses an invalid email destination so money never goes to an unknown recipient', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      await expect(
        p.initiate({
          payoutRequestId: 'req_2',
          destination: 'not-an-email',
          amountMinor: 2500,
          currency: 'USD',
        }),
      ).rejects.toThrow(/recipient email/);
    });

    it('refuses a non-positive amount', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      await expect(
        p.initiate({
          payoutRequestId: 'req_3',
          destination: 'dev@example.com',
          amountMinor: 0,
          currency: 'USD',
        }),
      ).rejects.toThrow(/non-positive amount/);
    });

    it('creates and funds a non-USD transfer using the documented Wise API sequence', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const fetchMock = vi.fn(async (url: string, init: any) => {
        if (url.includes('/v1/accounts?')) {
          expect(url).toContain('currency=EUR');
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/v1/accounts')) {
          expect(JSON.parse(init.body).currency).toBe('EUR');
          return new Response(JSON.stringify({ id: 555 }), { status: 200 });
        }
        if (url.includes('/v3/profiles/123/quotes')) {
          expect(JSON.parse(init.body)).toMatchObject({
            sourceCurrency: 'EUR',
            targetCurrency: 'EUR',
            targetAmount: 25,
            targetAccount: 555,
            preferredPayIn: 'BALANCE',
          });
          return new Response(JSON.stringify({ id: 'quote-123' }), { status: 200 });
        }
        if (url.includes('/v1/transfers')) {
          expect(JSON.parse(init.body)).toMatchObject({ amount: 25, currency: 'EUR' });
          return new Response(JSON.stringify({ id: 999, status: 'incoming_payment_waiting' }), {
            status: 200,
          });
        }
        if (url.includes('/transfers/999/payments')) {
          expect(JSON.parse(init.body)).toEqual({ type: 'BALANCE' });
          return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await p.initiate({
        payoutRequestId: 'req_4',
        destination: 'dev@example.com',
        amountMinor: 2500,
        currency: 'EUR',
      });

      expect(res.providerTxId).toBe('999');
      // A transfer POST must have been issued.
      const transferCall = fetchMock.mock.calls.find((c: any[]) => c[0].includes('/v1/transfers'));
      expect(transferCall).toBeTruthy();
      expect(transferCall[1].method).toBe('POST');
      const logText = logSpy.mock.calls.flat().join(' ');
      expect(logText).not.toContain('dev@example.com');
      expect(logText).toContain(
        privacyPseudonym('dev@example.com', 'wise-payout-destination').slice(0, 12),
      );
      expect(logText).not.toContain(
        createHash('sha256').update('dev@example.com').digest('hex').slice(0, 8),
      );
    });

    it('rejects amounts that cannot cross the Wise number boundary exactly', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
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

    it.each([
      ['HTTP 400', new Response('{}', { status: 400 })],
      ['HTTP 500', new Response('{}', { status: 500 })],
      ['REJECTED body', new Response(JSON.stringify({ status: 'REJECTED' }), { status: 200 })],
      ['malformed body', new Response(JSON.stringify({}), { status: 200 })],
    ])(
      'keeps allocations reserved when post-transfer funding returns %s',
      async (_label, response) => {
        const p = makeProvider({ token: 'tok', profileId: '123' });
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 555 }), { status: 200 }))
            .mockResolvedValueOnce(
              new Response(JSON.stringify({ id: 'quote-safe' }), { status: 200 }),
            )
            .mockResolvedValueOnce(
              new Response(JSON.stringify({ id: 999, status: 'incoming_payment_waiting' }), {
                status: 200,
              }),
            )
            .mockResolvedValueOnce(response),
        );

        await expect(
          p.initiate({
            payoutRequestId: 'req_funding_failure',
            destination: 'dev@example.com',
            amountMinor: 2500n,
            currency: 'USD',
          }),
        ).rejects.toMatchObject({ name: 'PayoutProviderUnsafeFailure' });
      },
    );

    it('treats a definitive transfer 400 as failed and a 500 as ambiguous', async () => {
      const run = async (status: number) => {
        const p = makeProvider({ token: 'tok', profileId: '123' });
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 555 }), { status: 200 }))
            .mockResolvedValueOnce(
              new Response(JSON.stringify({ id: 'quote-safe' }), { status: 200 }),
            )
            .mockResolvedValueOnce(new Response('{}', { status })),
        );
        return p.initiate({
          payoutRequestId: `req_transfer_${status}`,
          destination: 'dev@example.com',
          amountMinor: 2500n,
          currency: 'USD',
        });
      };

      await expect(run(400)).resolves.toMatchObject({ status: 'failed' });
      await expect(run(500)).rejects.toMatchObject({ name: 'PayoutProviderUnsafeFailure' });
    });
  });

  describe('checkStatus', () => {
    it('maps a successful Wise transfer state to paid', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                status: 'outgoing_payment_sent',
                created: '2026-01-01T00:00:00.000Z',
              }),
              { status: 200 },
            ),
        ),
      );

      const res = await p.checkStatus('transfer_1');

      expect(res.status).toBe('paid');
      expect(res.paidAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      vi.unstubAllGlobals();
    });

    it('maps failed Wise transfer states to failed and leaves unknown states processing', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'funds_refunded' }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'incoming_payment_waiting' }), { status: 200 }),
        );
      vi.stubGlobal('fetch', fetchMock);

      await expect(p.checkStatus('transfer_2')).resolves.toMatchObject({ status: 'failed' });
      await expect(p.checkStatus('transfer_3')).resolves.toMatchObject({ status: 'processing' });
      vi.unstubAllGlobals();
    });
  });
});
