import { PayoutStatus } from '@waitlayer/shared';

export const RESERVED_PAYOUT_STATUSES = [
  PayoutStatus.REQUESTED,
  PayoutStatus.UNDER_REVIEW,
  PayoutStatus.APPROVED,
  PayoutStatus.PROCESSING,
] as PayoutStatus[];

export const AVAILABLE_ENTRIES_DEFAULT_LIMIT = 100;

export const AVAILABLE_ENTRIES_MAX_LIMIT = 500;

export const ALLOCATION_QUERY_PAGE_SIZE = 500;

export function boundedPositiveInt(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Payout provider interface — each provider implements this */
export interface PayoutProviderHandler {
  readiness?():
    | {
        ok: true;
      }
    | {
        ok: false;
        reason: string;
      };
  initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: number;
    currency: string;
  }): Promise<{
    providerTxId: string;
    status: string;
  }>;
  checkStatus(
    providerTxId: string,
    context?: {
      destination?: string;
    },
  ): Promise<{
    status: string;
    paidAt?: Date;
  }>;
}

/** Manual payout provider — for MVP, admin processes manually */
export class ManualPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string }) {
    return { providerTxId: `manual_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

/** PayPal Email payout provider — for MVP, admin sends manually to email */
export class PayPalEmailPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string; destination: string }) {
    return { providerTxId: `paypal_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

export class StubPayoutProvider implements PayoutProviderHandler {
  constructor(
    private readonly providerName: string,
    private readonly txPrefix: string,
  ) {}
  readiness():
    | {
        ok: true;
      }
    | {
        ok: false;
        reason: string;
      } {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        reason: `${this.providerName} payout provider is not implemented for production processing. Use manual processing or wire a real PSP integration first.`,
      };
    }
    return { ok: true };
  }
  async initiate(params: { payoutRequestId: string }) {
    const ready = this.readiness();
    if (!ready.ok) throw new Error(ready.reason);
    return { providerTxId: `${this.txPrefix}_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}
