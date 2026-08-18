import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDodoLiveInputs, verifyDodoLive } from './verify-dodo-live.mjs';

const VALID = {
  RUN_DODO_LIVE_CHECK: '1',
  DEPOSIT_PROCESSOR: 'dodo',
  DODO_BASE_URL: 'https://live.dodopayments.com',
  DODO_API_KEY: 'live-key-not-printed',
  DODO_WEBHOOK_SECRET: 'webhook-secret-not-printed',
  DODO_PRODUCT_ID: 'pdt_wallet_top_up',
};

test('requires explicit opt-in and the complete live Dodo configuration', () => {
  const errors = validateDodoLiveInputs({});
  assert.match(errors.join('\n'), /RUN_DODO_LIVE_CHECK=1/);
  assert.match(errors.join('\n'), /DODO_API_KEY/);
  assert.match(errors.join('\n'), /DODO_WEBHOOK_SECRET/);
  assert.match(errors.join('\n'), /DODO_PRODUCT_ID/);
  assert.match(errors.join('\n'), /DODO_BASE_URL/);
});

test('rejects the Dodo test endpoint for a live check', () => {
  const errors = validateDodoLiveInputs({
    ...VALID,
    DODO_BASE_URL: 'https://test.dodopayments.com',
  });
  assert.match(errors.join('\n'), /DODO_BASE_URL/);
});

test('verifies products without logging or parsing the response body', async () => {
  let request;
  let bodyConsumed = false;
  const result = await verifyDodoLive({
    env: VALID,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          bodyConsumed = true;
          return new ArrayBuffer(0);
        },
      };
    },
  });

  assert.deepEqual(result, {
    endpoint: 'https://live.dodopayments.com',
    status: 200,
    productIdConfigured: true,
  });
  assert.equal(request.url, 'https://live.dodopayments.com/products');
  assert.equal(request.init.headers.Authorization, 'Bearer live-key-not-printed');
  assert.equal(request.init.headers.Accept, 'application/json');
  assert.equal(bodyConsumed, true);
});

test('reports provider status without exposing its response body', async () => {
  await assert.rejects(
    verifyDodoLive({
      env: VALID,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => 'provider body must not be read or printed',
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    }),
    /HTTP 401/,
  );
});

test('converts network failures and timeouts to safe diagnostics', async () => {
  await assert.rejects(
    verifyDodoLive({
      env: VALID,
      fetchImpl: async () => {
        throw new Error('network failure with secret-like detail');
      },
    }),
    /endpoint was unreachable/,
  );

  await assert.rejects(
    verifyDodoLive({
      env: VALID,
      timeoutMs: 1,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    }),
    /timed out after 1ms/,
  );
});
