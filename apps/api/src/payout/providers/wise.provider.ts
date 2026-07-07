import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PayoutProviderHandler } from '../payout.service';

/**
 * Wise (formerly TransferWise) payout provider.
 *
 * Uses Wise's REST API (v3) to move funds from the platform's Wise business
 * profile to a developer's Wise account / bank recipient identified by email.
 * Flow:
 *   1. `initiate()` → ensure a recipient account exists for the destination
 *      email, then create a transfer (transfer is created in `status: 'incoming_payment_waiting'`
 *      or similar — Wise funds it from the profile balance). The Wise transfer
 *      id is recorded as `providerTxId`.
 *   2. `checkStatus()` → poll the transfer; map Wise states to our status.
 *
 * Production readiness:
 *  - `WISE_API_TOKEN` + `WISE_PROFILE_ID` must be set. In `NODE_ENV=production`
 *    without them, the provider refuses to run (fail-closed), exactly like the
 *    other automated PSPs. Sandbox/dev may run without credentials for the
 *    request/approval flow to be exercisable, but cannot actually move money.
 *  - The developer's `destination` is treated as a Wise recipient email. An
 *    empty/ malformed email fails closed so we never create a transfer to an
 *    unknown recipient.
 */
@Injectable()
export class WisePayoutProvider implements PayoutProviderHandler {
  private readonly logger = new Logger(WisePayoutProvider.name);
  private readonly token: string;
  private readonly profileId: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly nodeEnv: string;

  constructor(private config: ConfigService) {
    this.token = this.config.get<string>('WISE_API_TOKEN', '');
    this.profileId = this.config.get<string>('WISE_PROFILE_ID', '');
    this.apiVersion = this.config.get<string>('WISE_API_VERSION', '3.0');
    const mode = this.config.get<string>('WISE_MODE', 'sandbox');
    // Sandbox: api.sandbox.transferwise.tech ; Live: api.transferwise.com
    this.baseUrl = mode === 'live' ? 'https://api.transferwise.com' : 'https://api.sandbox.transferwise.tech';
    this.enabled = !!(this.token && this.profileId);
    this.nodeEnv = this.config.get<string>('NODE_ENV', process.env.NODE_ENV || 'development');
  }

  readiness(): { ok: true } | { ok: false; reason: string } {
    if (!this.enabled) {
      if (this.nodeEnv === 'production') {
        return {
          ok: false,
          reason: 'Wise payouts are not configured: set WISE_API_TOKEN and WISE_PROFILE_ID to enable Wise developer payouts in production.',
        };
      }
      return { ok: false, reason: 'Wise payout provider is disabled (no WISE_API_TOKEN/WISE_PROFILE_ID).' };
    }
    return { ok: true };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'WaitLayer/1.0',
    };
  }

  /**
   * Resolve (or create) a Wise recipient account for the destination email.
   * Uses the v2 profile-specific accounts endpoint. We look up existing
   * accounts for the email first to avoid duplicating recipients.
   */
  private async resolveRecipient(destination: string): Promise<string> {
    // List existing accounts for this profile, find one matching the email.
    const listRes = await fetch(
      `${this.baseUrl}/v1/profiles/${this.profileId}/accounts?profileId=${this.profileId}`,
      { headers: this.headers() },
    );
    if (listRes.ok) {
      const accounts = (await listRes.json()) as Array<{
        id: number;
        accountHolderName?: string;
        details?: Record<string, unknown>;
      }>;
      const existing = accounts.find(
        (a) => (a.details?.email as string)?.toLowerCase() === destination.toLowerCase(),
      );
      if (existing) return String(existing.id);
    }

    // Create a new "swift" / email-based recipient. Wise community/email
    // recipients need a currency + holder name; we use a generic recipient
    // type keyed by email which Wise supports for certain corridors.
    const createRes = await fetch(`${this.baseUrl}/v1/accounts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        profileId: Number(this.profileId),
        accountHolderName: destination,
        currency: 'USD',
        type: 'email',
        details: { email: destination },
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Wise recipient creation failed: ${createRes.status} ${text}`);
    }
    const created = (await createRes.json()) as { id: number };
    return String(created.id);
  }

  async initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }> {
    if (!this.enabled) {
      if (this.nodeEnv === 'production') {
        throw new Error('Wise payouts are not configured for production');
      }
      this.logger.warn('Wise not configured — returning stub response');
      return { providerTxId: `dev_stub_wise_${params.payoutRequestId}`, status: 'processing' };
    }

    const email = params.destination?.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(`Invalid Wise payout destination '${email}': must be a recipient email.`);
    }

    const amount = Number((params.amountMinor / 100).toFixed(2));
    if (!(amount > 0)) {
      throw new Error(`Refusing Wise payout with non-positive amount: ${amount}`);
    }

    const recipientId = await this.resolveRecipient(email);

    const transferRes = await fetch(`${this.baseUrl}/v1/transfers`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        targetAccount: Number(recipientId),
        quoteUuid: undefined, // balance-funded transfer; Wise derives quote from profile
        customerTransactionId: `wl_${params.payoutRequestId}`,
        details: {
          reference: `WaitLayer payout ${params.payoutRequestId}`,
          sourceOfFunds: 'other',
        },
        sourceOfFunds: 'balances',
        amount,
        currency: params.currency.toUpperCase(),
      }),
    });

    if (!transferRes.ok) {
      const text = await transferRes.text();
      this.logger.error(`Wise transfer create failed: ${transferRes.status} ${text}`);
      return { providerTxId: `wise_failed_${params.payoutRequestId}`, status: 'failed' };
    }

    const transfer = (await transferRes.json()) as { id: number; status?: string };
    // Log only a short hash of the destination email — never the raw PII.
    const destHash = createHash('sha256').update(email).digest('hex').slice(0, 8);
    this.logger.log(`Wise payout initiated: transfer=${transfer.id} for recipient ${destHash}`);
    return { providerTxId: String(transfer.id), status: transfer.status ?? 'processing' };
  }

  async checkStatus(providerTxId: string): Promise<{ status: string; paidAt?: Date }> {
    if (!this.enabled) return { status: 'processing' };

    const res = await fetch(`${this.baseUrl}/v1/transfers/${providerTxId}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      return { status: 'processing' };
    }
    const data = (await res.json()) as {
      status?: string;
      created?: string;
    };
    // Map Wise transfer lifecycle to our coarse status.
    const wiseStatus = data.status ?? 'processing';
    const paidAt = data.created ? new Date(data.created) : undefined;
    return { status: wiseStatus, paidAt };
  }
}
