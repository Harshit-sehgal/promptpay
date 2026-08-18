#!/usr/bin/env node
/**
 * Opt-in Dodo live credential check.
 *
 * This verifies only that the configured live API key can reach Dodo's products
 * endpoint. It does not create a checkout, enable a money switch, or inspect
 * and print response bodies. A real checkout/webhook test remains a separate
 * operator action because it can create provider-side state.
 *
 * Run explicitly with:
 *   RUN_DODO_LIVE_CHECK=1 \
 *   DEPOSIT_PROCESSOR=dodo \
 *   DODO_BASE_URL=https://live.dodopayments.com \
 *   DODO_API_KEY=<live key> \
 *   DODO_WEBHOOK_SECRET=<webhook secret> \
 *   DODO_PRODUCT_ID=<wallet top-up product> \
 *   pnpm dodo:verify-live
 */
import { fileURLToPath } from 'node:url';

const LIVE_DODO_HOST = 'live.dodopayments.com';
const DEFAULT_TIMEOUT_MS = 10_000;

function normalizedOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.hostname.toLowerCase() !== LIVE_DODO_HOST
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function validateDodoLiveInputs(env) {
  const errors = [];
  if (env.RUN_DODO_LIVE_CHECK !== '1') {
    errors.push('RUN_DODO_LIVE_CHECK=1 is required; this command is deliberately opt-in');
  }
  if (env.DEPOSIT_PROCESSOR !== 'dodo') {
    errors.push('DEPOSIT_PROCESSOR=dodo is required for the live rail check');
  }
  if (!env.DODO_API_KEY) errors.push('DODO_API_KEY is required');
  if (!env.DODO_WEBHOOK_SECRET) errors.push('DODO_WEBHOOK_SECRET is required');
  if (!env.DODO_PRODUCT_ID) errors.push('DODO_PRODUCT_ID is required');
  if (!normalizedOrigin(env.DODO_BASE_URL ?? '')) {
    errors.push(`DODO_BASE_URL must be https://${LIVE_DODO_HOST}`);
  }
  return errors;
}

export async function verifyDodoLive({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const errors = validateDodoLiveInputs(env);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  const baseUrl = normalizedOrigin(env.DODO_BASE_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/products`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.DODO_API_KEY}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Dodo live products check timed out after ${timeoutMs}ms`);
    }
    throw new Error('Dodo live products check failed — the endpoint was unreachable');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Dodo live products check returned HTTP ${response.status}`);
  }

  // Consume the body so the connection can be reused, but deliberately do not
  // parse or print it: provider response bodies can contain product metadata.
  await response.arrayBuffer();

  return {
    endpoint: baseUrl,
    status: response.status,
    productIdConfigured: true,
  };
}

async function main() {
  try {
    const result = await verifyDodoLive();
    console.log(
      `[dodo-live] products endpoint verified (${result.status}); configured product id was not printed`,
    );
  } catch (error) {
    console.error(`[dodo-live] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
