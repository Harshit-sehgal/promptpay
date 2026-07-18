import { describe, expect, it, vi } from 'vitest';

import { ApiClient, resolveApiBaseUrl } from './api-client';
import { Credentials } from './credentials';

const creds: Credentials = {
  email: 'dev@example.com',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  userId: 'user_123',
  role: 'developer',
};

function raw(client: ApiClient, url: string) {
  return (
    client as unknown as {
      raw<T>(method: 'GET' | 'POST' | 'PATCH', path: string): Promise<T>;
    }
  ).raw('GET', url);
}

function stubRaw(client: ApiClient, response: unknown) {
  const request = vi.fn().mockResolvedValue(response);
  (client as unknown as { raw: typeof request }).raw = request;
  return request;
}

describe('ApiClient transport policy', () => {
  it('refuses cleartext requests to non-loopback hosts', async () => {
    await expect(raw(new ApiClient(creds), 'http://example.com/api/v1/auth/me')).rejects.toThrow(
      /refuses to send credentials/,
    );
  });

  it('refuses non-HTTP protocols even for loopback hosts', async () => {
    await expect(raw(new ApiClient(creds), 'ftp://localhost/api/v1/auth/me')).rejects.toThrow(
      /refuses to send credentials/,
    );
  });
});

describe('resolveApiBaseUrl (A-013)', () => {
  const base = { WAITLAYER_API_URL: undefined, NODE_ENV: undefined };

  it('defaults to the production origin for a packaged install', () => {
    expect(resolveApiBaseUrl({ ...base })).toBe('https://api.waitlayer.com/api/v1');
  });

  it('honours an explicit WAITLAYER_API_URL override (local dev)', () => {
    expect(resolveApiBaseUrl({ ...base, WAITLAYER_API_URL: 'http://localhost:4002/api/v1' })).toBe(
      'http://localhost:4002/api/v1',
    );
  });

  it('uses the production origin when NODE_ENV=production', () => {
    expect(resolveApiBaseUrl({ ...base, NODE_ENV: 'production' })).toBe(
      'https://api.waitlayer.com/api/v1',
    );
  });

  it('prefers WAITLAYER_API_URL even when NODE_ENV=production', () => {
    expect(
      resolveApiBaseUrl({
        ...base,
        NODE_ENV: 'production',
        WAITLAYER_API_URL: 'http://localhost:4002/api/v1',
      }),
    ).toBe('http://localhost:4002/api/v1');
  });
});

describe('ApiClient currency totals', () => {
  it('preserves and parses ledger balance currency maps', async () => {
    const client = new ApiClient(creds);
    const request = stubRaw(client, {
      available: { amountMinor: '2500', currency: 'USD', byCurrency: { USD: '2500', EUR: '125' } },
      pending: { amountMinor: '900', currency: 'EUR', byCurrency: { USD: '50', EUR: '900' } },
      total: { amountMinor: '4000', currency: 'EUR', byCurrency: { USD: '1000', EUR: '4000' } },
      paidOut: { amountMinor: '1500', currency: 'USD', byCurrency: { USD: '1500', EUR: '300' } },
    });

    const result = await client.getBalance();

    expect(request).toHaveBeenCalledWith('GET', '/ledger/balance', undefined);
    expect(result.available.byCurrency).toEqual({ USD: 2500n, EUR: 125n });
    expect(result.pending.byCurrency).toEqual({ USD: 50n, EUR: 900n });
    expect(result.total.byCurrency).toEqual({ USD: 1000n, EUR: 4000n });
    expect(result.paidOut.byCurrency).toEqual({ USD: 1500n, EUR: 300n });
  });

  it('preserves ledger amounts above Number.MAX_SAFE_INTEGER', async () => {
    const client = new ApiClient(creds);
    stubRaw(client, {
      available: {
        amountMinor: '9007199254740993',
        currency: 'USD',
        byCurrency: { USD: '9007199254740993' },
      },
      pending: { amountMinor: '0', currency: 'USD', byCurrency: { USD: '0' } },
      total: {
        amountMinor: '9007199254740993',
        currency: 'USD',
        byCurrency: { USD: '9007199254740993' },
      },
      paidOut: { amountMinor: '0', currency: 'USD', byCurrency: { USD: '0' } },
    });

    const result = await client.getBalance();

    expect(result.available.amountMinor).toBe(9_007_199_254_740_993n);
    expect(result.available.byCurrency?.USD).toBe(9_007_199_254_740_993n);
  });

  it('preserves and parses developer dashboard currency maps', async () => {
    const client = new ApiClient(creds);
    const request = stubRaw(client, {
      estimatedEarnings: '425',
      confirmedEarnings: '125',
      pendingEarnings: '900',
      heldEarnings: '75',
      availableForPayoutMinor: '125',
      recoveryDebtMinor: '0',
      lifetimeEarnings: '4000',
      estimatedEarningsByCurrency: { USD: '6000', EUR: '425' },
      confirmedEarningsByCurrency: { USD: '2500', EUR: '125' },
      pendingEarningsByCurrency: { USD: '50', EUR: '900' },
      heldEarningsByCurrency: { USD: '25', EUR: '75' },
      availableForPayoutByCurrency: { USD: '2500', EUR: '125' },
      lifetimeEarningsByCurrency: { USD: '1000', EUR: '4000' },
      trustLevel: 'normal',
      trustScore: 72,
    });

    const result = await client.getOverview();

    expect(request).toHaveBeenCalledWith('GET', '/developer/dashboard', undefined);
    expect(result.estimatedEarningsByCurrency).toEqual({ USD: 6000n, EUR: 425n });
    expect(result.confirmedEarningsByCurrency).toEqual({ USD: 2500n, EUR: 125n });
    expect(result.pendingEarningsByCurrency).toEqual({ USD: 50n, EUR: 900n });
    expect(result.heldEarningsByCurrency).toEqual({ USD: 25n, EUR: 75n });
    expect(result.availableForPayoutByCurrency).toEqual({ USD: 2500n, EUR: 125n });
    expect(result.lifetimeEarningsByCurrency).toEqual({ USD: 1000n, EUR: 4000n });
  });
});
