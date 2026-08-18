import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { DodoProvider } from './dodo.provider';

function makeProvider(config: Record<string, string> = {}) {
  const get = vi.fn((key: string, fallback = '') => config[key] ?? fallback);
  const provider = new DodoProvider({ get } as unknown as ConfigService);
  return { provider, get };
}

const FULL_CONFIG = {
  DODO_API_KEY: 'test-key',
  DODO_BASE_URL: 'https://test.dodopayments.com',
  DODO_WEBHOOK_SECRET: 'whsec_test',
  DODO_PRODUCT_ID: 'pdt_123',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DodoProvider', () => {
  it('is disabled without credentials', () => {
    const { provider } = makeProvider();
    expect(provider.isEnabled()).toBe(false);
    expect(provider.name).toBe('dodo');
    expect(provider.readiness()).toMatchObject({ ok: false });
  });

  it('is enabled with the full credential set', () => {
    const { provider } = makeProvider(FULL_CONFIG);
    expect(provider.isEnabled()).toBe(true);
    expect(provider.readiness()).toEqual({ ok: true });
  });

  it('fails closed when the webhook secret is missing', () => {
    const { DODO_WEBHOOK_SECRET: _webhookSecret, ...checkoutOnlyConfig } = FULL_CONFIG;
    const { provider } = makeProvider(checkoutOnlyConfig);
    expect(provider.isEnabled()).toBe(false);
    expect(provider.readiness()).toMatchObject({ ok: false });
    expect(provider.readiness()).toMatchObject({
      reason: expect.stringContaining('DODO_WEBHOOK_SECRET'),
    });
  });

  it('fails closed when the API base URL is not the documented HTTPS Dodo host', () => {
    const { provider } = makeProvider({ ...FULL_CONFIG, DODO_BASE_URL: 'http://evil.example' });
    expect(provider.isEnabled()).toBe(false);
    expect(provider.readiness()).toEqual({
      ok: false,
      reason: expect.stringContaining('https://test.dodopayments.com'),
    });
  });

  it('refuses to create a session when unconfigured', async () => {
    const { provider } = makeProvider();
    await expect(
      provider.createDepositSession({
        advertiserId: 'adv-1',
        amountMinor: 1000n,
        currency: 'usd',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow(/not configured/);
  });

  it('creates a checkout session and returns sessionId + url', async () => {
    const { provider } = makeProvider(FULL_CONFIG);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: 'cks_1',
        checkout_url: 'https://checkout.dodopayments.com/x',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.createDepositSession({
      advertiserId: 'adv-1',
      amountMinor: 1000n,
      currency: 'usd',
      successUrl: 'https://example.com/ok',
      cancelUrl: 'https://example.com/cancel',
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({ sessionId: 'cks_1', url: 'https://checkout.dodopayments.com/x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.dodopayments.com/checkouts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.product_cart).toEqual([{ product_id: 'pdt_123', quantity: 1, amount: 1000 }]);
    expect(body.billing_currency).toBe('USD');
    expect(body.metadata).toEqual({ advertiserId: 'adv-1' });
    expect(body.return_url).toBe('https://example.com/ok');
    expect(body.cancel_url).toBe('https://example.com/cancel');
  });

  it('fails when Dodo returns a non-2xx', async () => {
    const { provider } = makeProvider(FULL_CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }),
    );

    await expect(
      provider.createDepositSession({
        advertiserId: 'adv-1',
        amountMinor: 1000n,
        currency: 'usd',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('fails when Dodo returns an unsafe checkout URL', async () => {
    const { provider } = makeProvider(FULL_CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ session_id: 'cks_1', checkout_url: 'javascript:alert(1)' }),
      }),
    );

    await expect(
      provider.createDepositSession({
        advertiserId: 'adv-1',
        amountMinor: 1000n,
        currency: 'usd',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow(/unsafe checkout URL/);
  });

  it('fails when Dodo omits the checkout_url', async () => {
    const { provider } = makeProvider(FULL_CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ session_id: 'cks_1' }) }),
    );

    await expect(
      provider.createDepositSession({
        advertiserId: 'adv-1',
        amountMinor: 1000n,
        currency: 'usd',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow(/checkout URL/);
  });

  it('refuses a non-positive or oversized amount before calling Dodo', async () => {
    const { provider } = makeProvider(FULL_CONFIG);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provider.createDepositSession({
        advertiserId: 'adv-1',
        amountMinor: 0n,
        currency: 'usd',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow(/non-positive/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
