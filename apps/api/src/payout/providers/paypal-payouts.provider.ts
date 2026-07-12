import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { minorToMajorInputValue } from '@waitlayer/shared';

import { PayoutProviderHandler } from '../payout.service';

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
}

interface PayPalPayoutResponse {
  items?: Array<{ payout_item_id?: string }>;
}

interface PayPalPayoutStatusResponse {
  transaction_status?: string;
  time_processed?: string;
}

/**
 * Real PayPal Payouts API provider.
 *
 * Uses the PayPal Payouts API to send payments to developer PayPal accounts.
 * Supports both sandbox and live modes via PAYPAL_MODE env var.
 *
 * Flow:
 *  1. `initiate()` → calls PayPal /v1/payments/payouts API to create a payout item
 *  2. `checkStatus()` → calls PayPal /v1/payments/payouts-item/<id> to check status
 *
 * The PayPal Payouts SDK handles OAuth token management automatically.
 */
@Injectable()
export class PayPalPayoutsProvider implements PayoutProviderHandler {
  private readonly logger = new Logger(PayPalPayoutsProvider.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly nodeEnv: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(private config: ConfigService) {
    this.clientId = this.config.get<string>('PAYPAL_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('PAYPAL_CLIENT_SECRET', '');
    const mode = this.config.get<string>('PAYPAL_MODE', 'sandbox');
    this.baseUrl =
      mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    this.enabled = !!(this.clientId && this.clientSecret);
    this.nodeEnv = this.config.get<string>('NODE_ENV', process.env.NODE_ENV || 'development');
  }

  /** Whether PayPal is configured */
  isEnabled(): boolean {
    return this.enabled;
  }

  readiness(): { ok: true } | { ok: false; reason: string } {
    if (!this.enabled && this.nodeEnv === 'production') {
      return {
        ok: false,
        reason:
          'PayPal Payouts is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before processing paypal_payouts requests in production.',
      };
    }
    return { ok: true };
  }

  /** Get a valid OAuth access token, refreshing if needed */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PayPal OAuth failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as PayPalTokenResponse;
    this.accessToken = data.access_token;
    // Refresh 60 seconds before actual expiry
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken!;
  }

  /**
   * Initiate a PayPal payout to a receiver email.
   * Creates a single-payout batch via the PayPal Payouts API.
   */
  async initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }> {
    if (!this.enabled) {
      if (this.nodeEnv === 'production') {
        throw new Error('PayPal Payouts is not configured for production');
      }
      this.logger.warn('PayPal not configured — returning stub response');
      return { providerTxId: `dev_stub_paypal_${params.payoutRequestId}`, status: 'processing' };
    }

    const email = params.destination?.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(`Invalid PayPal payout destination '${email}': must be a recipient email.`);
    }

    const amount = minorToMajorInputValue(params.amountMinor, params.currency);
    if (!(Number(amount) > 0)) {
      throw new Error(`Refusing PayPal payout with non-positive amount: ${amount}`);
    }

    const token = await this.getAccessToken();
    const senderItemId = `wl_${params.payoutRequestId}`;

    const res = await fetch(`${this.baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: `batch_${params.payoutRequestId}`,
          email_subject: 'You have a payout from WaitLayer',
          email_message:
            'You have received a payout from WaitLayer. Thanks for your participation!',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: {
              value: amount,
              currency: params.currency.toUpperCase(),
            },
            receiver: email,
            sender_item_id: senderItemId,
            note: 'WaitLayer developer payout',
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`PayPal payout initiate failed: ${res.status} ${text}`);
      // Return as failed rather than throwing — let the system retry
      return { providerTxId: `paypal_failed_${params.payoutRequestId}`, status: 'failed' };
    }

    const data = (await res.json()) as PayPalPayoutResponse;
    const payoutItemId = data.items?.[0]?.payout_item_id ?? `paypal_${params.payoutRequestId}`;

    const destHash = createHash('sha256').update(email).digest('hex').slice(0, 8);
    this.logger.log(`PayPal payout initiated: ${payoutItemId} for recipient ${destHash}`);

    return { providerTxId: payoutItemId, status: 'processing' };
  }

  /**
   * Check the status of a PayPal payout item.
   */
  async checkStatus(providerTxId: string): Promise<{ status: string; paidAt?: Date }> {
    if (!this.enabled) {
      return { status: 'processing' };
    }

    const token = await this.getAccessToken();

    const res = await fetch(`${this.baseUrl}/v1/payments/payouts-item/${providerTxId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`PayPal status check failed: ${res.status} ${text}`);
      return { status: 'processing' };
    }

    const data = (await res.json()) as PayPalPayoutStatusResponse;
    const paypalStatus = data.transaction_status;

    // Map PayPal statuses to our PayoutStatus
    switch (paypalStatus) {
      case 'SUCCESS':
        return {
          status: 'paid',
          paidAt: data.time_processed ? new Date(data.time_processed) : new Date(),
        };
      case 'FAILED':
      case 'RETURNED':
      case 'BLOCKED':
        return { status: 'failed' };
      case 'ONHOLD':
      case 'PENDING':
      default:
        return { status: 'processing' };
    }
  }
}
