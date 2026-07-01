import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutProviderHandler } from '../payout.service';

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
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(private config: ConfigService) {
    this.clientId = this.config.get<string>('PAYPAL_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('PAYPAL_CLIENT_SECRET', '');
    const mode = this.config.get<string>('PAYPAL_MODE', 'sandbox');
    this.baseUrl = mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
    this.enabled = !!(this.clientId && this.clientSecret);
  }

  /** Whether PayPal is configured */
  isEnabled(): boolean {
    return this.enabled;
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

    const data = await res.json() as any;
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
    amountMinor: number;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }> {
    if (!this.enabled) {
      this.logger.warn('PayPal not configured — returning stub response');
      return { providerTxId: `paypal_stub_${params.payoutRequestId}`, status: 'processing' };
    }

    const token = await this.getAccessToken();
    const amount = (params.amountMinor / 100).toFixed(2);
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
          email_message: 'You have received a payout from WaitLayer. Thanks for your participation!',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: {
              value: amount,
              currency: params.currency.toUpperCase(),
            },
            receiver: params.destination,
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

    const data = await res.json() as any;
    const payoutItemId = data.items?.[0]?.payout_item_id ?? `paypal_${params.payoutRequestId}`;

    this.logger.log(`PayPal payout initiated: ${payoutItemId} for ${params.destination}`);

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

    const data = await res.json() as any;
    const paypalStatus = data.transaction_status;

    // Map PayPal statuses to our PayoutStatus
    switch (paypalStatus) {
      case 'SUCCESS':
        return { status: 'paid', paidAt: data.time_processed ? new Date(data.time_processed) : new Date() };
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
