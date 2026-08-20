import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { DodoProvider } from '../payout/providers/dodo.provider';

/**
 * W1.5 — Dodo deposit sandbox run (opt-in, real network).
 *
 * Verifies `DodoProvider.createDepositSession` against the real Dodo TEST
 * endpoint, so the request/response field mapping (pinned from Dodo's docs and
 * generated Go SDK) is exercised against the actual API rather than only
 * against mocked fetch responses in `dodo.provider.spec.ts`.
 *
 * Opt-in for two reasons: (1) it performs a real outbound call to Dodo, and
 * (2) it needs the operator's TEST credentials PLUS a configured wallet-top-up
 * product (`pay_what_you_want` enabled) — DODO_PAYMENTS_PLAN.md §8.1/§8.3,
 * neither of which exists yet. Without `RUN_DODO_SANDBOX=1` and the full test
 * credential set this suite skips cleanly, so a normal CI run never fails for
 * missing operator input.
 *
 * Run once §8.1/§8.3 are answered:
 *   RUN_DODO_SANDBOX=1 \
 *   DODO_API_KEY=<test key> \
 *   DODO_BASE_URL=https://test.dodopayments.com \
 *   DODO_WEBHOOK_SECRET=<test webhook secret> \
 *   DODO_PRODUCT_ID=<wallet-top-up product id> \
 *   pnpm --filter ateva-api exec vitest run src/integration/dodo-deposit-sandbox.spec.ts
 */
const sandboxConfigured = Boolean(
  process.env.RUN_DODO_SANDBOX === '1' &&
  process.env.DODO_API_KEY &&
  process.env.DODO_BASE_URL &&
  process.env.DODO_WEBHOOK_SECRET &&
  process.env.DODO_PRODUCT_ID &&
  /test\.dodopayments\.com|dodopayments\.com\/test/i.test(process.env.DODO_BASE_URL ?? ''),
);

describe.runIf(sandboxConfigured)(
  'Dodo deposit sandbox run (real network to the Dodo test endpoint)',
  () => {
    function makeProvider(): DodoProvider {
      // Read straight from the environment so the opt-in gate above and the
      // provider see the same values (no fallback drift).
      const get = (key: string, fallback = '') => process.env[key] ?? fallback;
      return new DodoProvider({ get } as unknown as ConfigService);
    }

    it('creates a single-use checkout session with a sessionId and URL', async () => {
      const provider = makeProvider();
      expect(provider.isEnabled()).toBe(true);

      const session = await provider.createDepositSession({
        advertiserId: 'sandbox-advertiser-001',
        amountMinor: 100n, // $1.00 — smallest sensible sandbox amount (USD minor units)
        currency: 'usd',
        successUrl: 'https://example.com/advertiser?deposit=success',
        cancelUrl: 'https://example.com/advertiser?deposit=cancelled',
        idempotencyKey: `sandbox-${Date.now()}`,
      });

      expect(session.sessionId).toBeTruthy();
      expect(session.url).toMatch(/^https:\/\//);
    });
  },
);
