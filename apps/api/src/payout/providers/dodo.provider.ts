import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { parsePublicHttpsUrl } from '../../common/utils/external-url-policy';
import { requireProviderSafeMinorAmount } from '../../common/utils/provider-amount';
import type { DepositSessionProvider } from '../deposit-processor';

/**
 * Upper bound for a single Dodo checkout amount, in minor units. Mirrors the
 * Stripe cap so an absurd amount is refused before it ever crosses the API
 * boundary (BigInt protects the ledger, but a provider call that rounds is a
 * silent money change — reject instead).
 */
export const DODO_MAX_MINOR_AMOUNT = 99_999_999n;

const DODO_API_HOSTS = new Set(['test.dodopayments.com', 'live.dodopayments.com']);

function normalizeDodoBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/') ||
      !DODO_API_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Dodo Payments deposit (money-in) provider.
 *
 * Dodo is a Merchant of Record: it supports checkout (money-IN) only and has
 * no third-party payout API, so this provider implements the deposit-session
 * side of the rail and nothing else (developer payouts run on platform rails
 * — decision D4).
 *
 * Uses `fetch`, not an SDK, per the dependency/audit gates. The checkout
 * endpoint and payload follow Dodo's documented Checkout Sessions API
 * (`POST {DODO_BASE_URL}/checkouts`), verified against
 * `developer-resources/checkout-session` on 2026-08-17:
 *   - auth: `Authorization: Bearer <DODO_API_KEY>`
 *   - `product_cart[].amount` is the lowest denomination (minor units), only
 *     honoured when the product has `pay_what_you_want` enabled (operator
 *     duty §8.3 — the "wallet top-up" product must be configured accordingly).
 *   - response: `{ session_id, checkout_url }`; `checkout_url` is single-use.
 */
@Injectable()
export class DodoProvider implements DepositSessionProvider {
  readonly name = 'dodo';

  private readonly logger = new Logger(DodoProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly productId: string;
  private readonly webhookSecret: string;
  private readonly enabled: boolean;
  private readonly baseUrlValid: boolean;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('DODO_API_KEY', '');
    const configuredBaseUrl = this.config.get<string>('DODO_BASE_URL', '');
    this.baseUrl = normalizeDodoBaseUrl(configuredBaseUrl) ?? '';
    this.baseUrlValid = Boolean(this.baseUrl);
    this.productId = this.config.get<string>('DODO_PRODUCT_ID', '');
    this.webhookSecret = this.config.get<string>('DODO_WEBHOOK_SECRET', '');
    // A checkout without a verifiable webhook is not a usable deposit rail:
    // the advertiser can pay, but Ateva cannot safely credit the ledger.
    this.enabled = Boolean(this.apiKey && this.baseUrl && this.productId && this.webhookSecret);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  readiness(): { ok: true } | { ok: false; reason: string } {
    if (!this.baseUrlValid) {
      return {
        ok: false,
        reason:
          'Dodo deposits are not configured: DODO_BASE_URL must be https://test.dodopayments.com or https://live.dodopayments.com.',
      };
    }
    if (!this.enabled) {
      return {
        ok: false,
        reason:
          'Dodo deposits are not configured: set DODO_API_KEY, DODO_BASE_URL, DODO_WEBHOOK_SECRET and DODO_PRODUCT_ID.',
      };
    }
    return { ok: true };
  }

  async createDepositSession(params: {
    advertiserId: string;
    amountMinor: bigint;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ sessionId: string; url: string }> {
    if (!this.enabled) {
      throw new Error(
        'Dodo is not configured (DODO_API_KEY/DODO_BASE_URL/DODO_WEBHOOK_SECRET/DODO_PRODUCT_ID missing)',
      );
    }

    const amountMinor = Number(
      requireProviderSafeMinorAmount(params.amountMinor, 'Dodo checkout', DODO_MAX_MINOR_AMOUNT),
    );

    const body = {
      product_cart: [{ product_id: this.productId, quantity: 1, amount: amountMinor }],
      billing_currency: params.currency.toUpperCase(),
      return_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        advertiserId: params.advertiserId,
        ...params.metadata,
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/checkouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      this.logger.error(
        `Dodo checkout request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error('Dodo checkout request failed — the deposit rail is unreachable');
    }

    if (!response.ok) {
      let detail = '';
      try {
        const text = await response.text();
        // Truncate: Dodo error bodies are diagnostic, not secrets, but the log
        // must stay bounded.
        detail = text.slice(0, 500);
      } catch {
        /* non-JSON/text error bodies are fine to ignore */
      }
      this.logger.error(
        `Dodo checkout creation returned ${response.status}: ${detail || '(no body)'}`,
      );
      throw new Error(`Dodo checkout creation failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as { session_id?: string; checkout_url?: string | null };
    if (!data.session_id || !data.checkout_url) {
      this.logger.error(
        `Dodo checkout response missing session_id/checkout_url: ${JSON.stringify(data).slice(0, 300)}`,
      );
      throw new Error('Dodo did not return a checkout URL');
    }

    let checkoutUrl: string;
    try {
      checkoutUrl = parsePublicHttpsUrl(data.checkout_url, 'Dodo checkout URL').value;
    } catch (err: unknown) {
      this.logger.error(
        `Dodo checkout response returned an unsafe checkout URL: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error('Dodo returned an unsafe checkout URL');
    }

    return { sessionId: data.session_id, url: checkoutUrl };
  }
}
