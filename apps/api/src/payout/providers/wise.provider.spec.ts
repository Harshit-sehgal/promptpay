import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WisePayoutProvider } from './wise.provider';

function makeProvider(opts: { token?: string; profileId?: string; mode?: string; nodeEnv?: string }) {
  const config = {
    get: (key: string) => {
      switch (key) {
        case 'WISE_API_TOKEN':
          return opts.token ?? '';
        case 'WISE_PROFILE_ID':
          return opts.profileId ?? '';
        case 'WISE_API_VERSION':
          return '3.0';
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

  describe('readiness', () => {
    it('is ready when token + profile id are configured', () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      expect(p.readiness()).toEqual({ ok: true });
    });

    it('fails closed in production without credentials', () => {
      const p = makeProvider({ nodeEnv: 'production' });
      expect(p.readiness().ok).toBe(false);
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

    it('creates a transfer via the Wise API when configured', async () => {
      const p = makeProvider({ token: 'tok', profileId: '123' });
      const fetchMock = vi.fn(async (url: string, _init: any) => {
        // Recipient list (GET on the profile accounts endpoint) → empty array.
        if (url.includes('/profiles/') && url.includes('/accounts')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        // Recipient create (POST /v1/accounts) → new account id.
        if (url.includes('/v1/accounts')) {
          return new Response(JSON.stringify({ id: 555 }), { status: 200 });
        }
        if (url.includes('/v1/transfers')) {
          return new Response(JSON.stringify({ id: 999, status: 'incoming_payment_waiting' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await p.initiate({
        payoutRequestId: 'req_4',
        destination: 'dev@example.com',
        amountMinor: 2500,
        currency: 'USD',
      });

      expect(res.providerTxId).toBe('999');
      // A transfer POST must have been issued.
      const transferCall = fetchMock.mock.calls.find((c: any[]) => c[0].includes('/v1/transfers'));
      expect(transferCall).toBeTruthy();
      expect(transferCall[1].method).toBe('POST');
      vi.unstubAllGlobals();
    });
  });
});
