import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { majorToMinor, minorToMajorInputValue } from '@waitlayer/shared';

import { privacyPseudonym } from '../../common/utils/privacy-hash';
import { requireProviderSafeMinorAmount } from '../../common/utils/provider-amount';
import { PayoutProviderHandler } from '../payout.service';
import { PayoutProviderUnsafeFailure } from '../payout-provider.errors';

const WISE_MAX_MINOR_AMOUNT = 999_999_999n;

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
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly nodeEnv: string;
  private readonly emailRecipientsVerified: boolean;

  constructor(private config: ConfigService) {
    this.token = this.config.get<string>('WISE_API_TOKEN', '');
    this.profileId = this.config.get<string>('WISE_PROFILE_ID', '');
    const mode = this.config.get<string>('WISE_MODE', 'sandbox');
    // Wise Sandbox V2 and production hosts.
    this.baseUrl = mode === 'live' ? 'https://api.wise.com' : 'https://api.wise-sandbox.com';
    this.enabled = !!(this.token && this.profileId);
    this.nodeEnv = this.config.get<string>('NODE_ENV', process.env.NODE_ENV || 'development');
    this.emailRecipientsVerified =
      this.config.get<string>('WISE_EMAIL_RECIPIENTS_VERIFIED', 'false') === 'true';
  }

  readiness(): { ok: true } | { ok: false; reason: string } {
    if (!this.enabled) {
      if (this.nodeEnv === 'production') {
        return {
          ok: false,
          reason:
            'Wise payouts are not configured: set WISE_API_TOKEN and WISE_PROFILE_ID to enable Wise developer payouts in production.',
        };
      }
      return {
        ok: false,
        reason: 'Wise payout provider is disabled (no WISE_API_TOKEN/WISE_PROFILE_ID).',
      };
    }
    if (!this.emailRecipientsVerified) {
      return {
        ok: false,
        reason:
          'Wise email-recipient payouts are not verified for this account. Set WISE_EMAIL_RECIPIENTS_VERIFIED=true only after Wise approval and live capability verification.',
      };
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
   * Uses the profile/currency-filtered v1 accounts endpoint. Wise documents
   * email-recipient support as corridor/account dependent, which is why this
   * entire provider is also capability-gated.
   * accounts for the email first to avoid duplicating recipients.
   */
  private async resolveRecipient(destination: string, currency: string): Promise<string> {
    // List existing accounts for this profile, find one matching the email.
    const listRes = await fetch(
      `${this.baseUrl}/v1/accounts?profileId=${encodeURIComponent(this.profileId)}&currency=${encodeURIComponent(currency)}`,
      { headers: this.headers() },
    );
    if (listRes.ok) {
      const accounts = (await listRes.json()) as Array<{
        id: number;
        accountHolderName?: string;
        currency?: string;
        details?: Record<string, unknown>;
      }>;
      const existing = accounts.find(
        (a) =>
          (a.details?.email as string)?.toLowerCase() === destination.toLowerCase() &&
          a.currency?.toUpperCase() === currency,
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
        currency,
        type: 'email',
        details: { email: destination },
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Wise recipient creation failed with status ${createRes.status}`);
    }
    const created = (await createRes.json()) as { id: number };
    return String(created.id);
  }

  /**
   * Create a Wise quote for a balance-funded transfer. Wise requires the
   * transfer to reference a quote UUID; without it the transfer is rejected.
   * Throws on failure so the caller fails closed instead of emitting a broken
   * transfer. NOTE: this flow must be validated against the Wise sandbox
   * (WISE_MODE=sandbox) before enabling WISE_MODE=live.
   */
  private async createQuote(
    recipientId: string,
    amount: number,
    currency: string,
  ): Promise<string> {
    const quoteRes = await fetch(
      `${this.baseUrl}/v3/profiles/${encodeURIComponent(this.profileId)}/quotes`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          sourceCurrency: currency,
          targetCurrency: currency,
          targetAmount: amount,
          targetAccount: Number(recipientId),
          payOut: 'BANK_TRANSFER',
          preferredPayIn: 'BALANCE',
        }),
      },
    );
    if (!quoteRes.ok) {
      throw new Error(`Wise quote creation failed with status ${quoteRes.status}`);
    }
    const quote = (await quoteRes.json()) as { id: string };
    if (!quote.id) {
      throw new Error('Wise quote creation returned no quote id');
    }
    return quote.id;
  }

  async initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }> {
    if (!this.enabled) {
      if (this.nodeEnv === 'production') {
        throw new Error('Wise payouts are not configured for production');
      }
      this.logger.warn('Wise not configured — returning stub response');
      return { providerTxId: `dev_stub_wise_${params.payoutRequestId}`, status: 'processing' };
    }
    const readiness = this.readiness();
    if (!readiness.ok) throw new Error(readiness.reason);

    const email = params.destination?.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error('Invalid Wise payout destination: must be a recipient email.');
    }

    const currency = params.currency.toUpperCase();
    const safeAmountMinor = requireProviderSafeMinorAmount(
      params.amountMinor,
      'Wise',
      WISE_MAX_MINOR_AMOUNT,
    );
    const amount = Number(minorToMajorInputValue(safeAmountMinor, currency));
    if (majorToMinor(amount, currency) !== safeAmountMinor) {
      throw new Error(
        `Refusing Wise payout amount ${safeAmountMinor}: conversion would lose minor-unit precision`,
      );
    }

    const recipientId = await this.resolveRecipient(email, currency);

    // Wise requires a quote before a transfer: the quote captures the rate and
    // the balance draw. A transfer sent without a valid `quoteUuid` is rejected
    // by Wise, so we create one first and fail closed if it cannot be created.
    const quoteUuid = await this.createQuote(recipientId, amount, currency);

    const transferRes = await fetch(`${this.baseUrl}/v1/transfers`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        targetAccount: Number(recipientId),
        quoteUuid,
        customerTransactionId: `wl_${params.payoutRequestId}`,
        details: {
          reference: `WaitLayer payout ${params.payoutRequestId}`,
          sourceOfFunds: 'other',
        },
        sourceOfFunds: 'balances',
        amount,
        currency,
      }),
    });

    if (!transferRes.ok) {
      this.logger.error(`Wise transfer create failed with status ${transferRes.status}`);
      if (transferRes.status === 429 || transferRes.status >= 500) {
        throw new PayoutProviderUnsafeFailure(
          `Wise transfer outcome is ambiguous after HTTP ${transferRes.status}; reconcile by customerTransactionId wl_${params.payoutRequestId}`,
        );
      }
      return { providerTxId: `wise_failed_${params.payoutRequestId}`, status: 'failed' };
    }

    const transfer = (await transferRes.json()) as { id: number; status?: string };
    const paymentRes = await fetch(
      `${this.baseUrl}/v3/profiles/${encodeURIComponent(this.profileId)}/transfers/${transfer.id}/payments`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ type: 'BALANCE' }),
      },
    );
    if (!paymentRes.ok) {
      // The transfer now exists and remains fundable/cancellable in Wise. A
      // funding error of any class must not release local allocations; an
      // operator must reconcile or cancel the remote transfer first.
      throw new PayoutProviderUnsafeFailure(
        `Wise transfer ${transfer.id} funding was not confirmed after HTTP ${paymentRes.status}; reconcile before releasing allocations`,
      );
    }
    const payment = (await paymentRes.json()) as { status?: string; errorCode?: string };
    if (payment.status !== 'COMPLETED') {
      throw new PayoutProviderUnsafeFailure(
        `Wise transfer ${transfer.id} funding returned ${payment.status ?? 'an unknown status'}; reconcile before releasing allocations`,
      );
    }
    const recipientRef = privacyPseudonym(email, 'wise-payout-destination').slice(0, 12);
    this.logger.log(`Wise payout initiated: transfer=${transfer.id} for recipient ${recipientRef}`);
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
    // Map Wise transfer lifecycle to the coarse statuses the payout cron
    // understands. Unknown states stay processing so a new provider state
    // cannot accidentally terminalize a payout.
    const wiseStatus = mapWiseTransferStatus(data.status);
    const paidAt = data.created ? new Date(data.created) : undefined;
    return { status: wiseStatus, paidAt };
  }
}

function mapWiseTransferStatus(status?: string): 'processing' | 'paid' | 'failed' {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return 'processing';

  if (normalized === 'paid' || normalized === 'outgoing_payment_sent') {
    return 'paid';
  }

  if (
    normalized === 'failed' ||
    normalized === 'cancelled' ||
    normalized === 'canceled' ||
    normalized === 'funds_refunded'
  ) {
    return 'failed';
  }

  return 'processing';
}
