import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { minorToMajorInputValue } from '@waitlayer/shared';

import { privacyPseudonym } from '../../common/utils/privacy-hash';
import { requireProviderSafeMinorAmount } from '../../common/utils/provider-amount';
import { PayoutProviderHandler } from '../payout.service';
import { PayoutProviderUnsafeFailure } from '../payout-provider.errors';

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
}

interface PayPalPayoutResponse {
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: string;
  };
}

interface PayPalPayoutStatusResponse {
  batch_header?: {
    batch_status?: string;
    time_completed?: string;
  };
}

/**
 * Real PayPal Payouts API provider.
 *
 * Uses the PayPal Payouts API to send payments to developer PayPal accounts.
 * Supports both sandbox and live modes via PAYPAL_MODE env var.
 *
 * Flow:
 *  1. `initiate()` → calls PayPal /v1/payments/payouts API to create a payout item
 *  2. `checkStatus()` → calls PayPal /v1/payments/payouts/<batch-id> to check status
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
      throw new Error(`PayPal OAuth failed with status ${res.status}`);
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
      throw new Error('Invalid PayPal payout destination: must be a recipient email.');
    }

    const safeAmountMinor = requireProviderSafeMinorAmount(params.amountMinor, 'PayPal Payouts');
    const amount = minorToMajorInputValue(safeAmountMinor, params.currency);

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
      this.logger.error(`PayPal payout initiate failed with status ${res.status}`);
      if (res.status === 429 || res.status >= 500) {
        throw new PayoutProviderUnsafeFailure(
          `PayPal payout outcome is ambiguous after HTTP ${res.status}; reconcile sender_batch_id=batch_${params.payoutRequestId}`,
        );
      }
      return { providerTxId: `paypal_failed_${params.payoutRequestId}`, status: 'failed' };
    }

    const data = (await res.json()) as PayPalPayoutResponse;
    const payoutBatchId = data.batch_header?.payout_batch_id;
    if (!payoutBatchId) {
      throw new PayoutProviderUnsafeFailure(
        `PayPal accepted payout batch_${params.payoutRequestId} but returned no payout_batch_id; reconcile before retrying`,
      );
    }

    const recipientRef = privacyPseudonym(email, 'paypal-payout-destination').slice(0, 12);
    this.logger.log(`PayPal payout initiated: ${payoutBatchId} for recipient ${recipientRef}`);

    return {
      providerTxId: payoutBatchId,
      status: data.batch_header?.batch_status === 'SUCCESS' ? 'paid' : 'processing',
    };
  }

  /**
   * Check the status of a PayPal payout item.
   */
  async checkStatus(providerTxId: string): Promise<{ status: string; paidAt?: Date }> {
    if (!this.enabled) {
      return { status: 'processing' };
    }

    const token = await this.getAccessToken();

    const res = await fetch(
      `${this.baseUrl}/v1/payments/payouts/${encodeURIComponent(providerTxId)}?page_size=1&page=1&total_required=true`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!res.ok) {
      this.logger.error(`PayPal status check failed with status ${res.status}`);
      return { status: 'processing' };
    }

    const data = (await res.json()) as PayPalPayoutStatusResponse;
    const paypalStatus = data.batch_header?.batch_status;

    // Map PayPal statuses to our PayoutStatus
    switch (paypalStatus) {
      case 'SUCCESS':
        return {
          status: 'paid',
          paidAt: data.batch_header?.time_completed
            ? new Date(data.batch_header.time_completed)
            : new Date(),
        };
      case 'DENIED':
      case 'CANCELED':
      case 'FAILED':
        return { status: 'failed' };
      case 'ONHOLD':
      case 'PENDING':
      default:
        return { status: 'processing' };
    }
  }
}
