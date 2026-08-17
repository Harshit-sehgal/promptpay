import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DodoProvider } from './providers/dodo.provider';
import { StripeProvider } from './providers/stripe.provider';

/**
 * W1.1 — the money-in (deposit-session) processor contract.
 *
 * The advertiser controller used to call `StripeProvider.createDepositSession`
 * directly, hard-coupling the deposit endpoint to one rail. This interface is
 * the seam that lets Dodo (the launch rail, decision D1) replace Stripe
 * (inactive, decision D2) without touching the controller.
 *
 * The shape is exactly the current Stripe contract so the existing Stripe
 * implementation slots in unchanged; DodoProvider implements the same shape.
 */
export interface DepositSessionProvider {
  /** Stable processor id — matches the DEPOSIT_PROCESSOR env value. */
  readonly name: string;
  /** Whether the provider has the credentials it needs to take deposits. */
  isEnabled(): boolean;
  createDepositSession(params: {
    advertiserId: string;
    amountMinor: bigint;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ sessionId: string; url: string }>;
}

export type DepositProcessorName = 'stripe' | 'dodo';

/**
 * Resolves the configured deposit processor from `DEPOSIT_PROCESSOR`.
 *
 * When `DEPOSIT_PROCESSOR` is unset or names an unknown processor this returns
 * `null`, and the controller fails closed with a clean 400 (parity with the
 * WEB_BASE_URL guard) — never a 500 — so a half-migrated deployment cannot
 * take deposits on an unexpected rail.
 */
@Injectable()
export class DepositProcessorService {
  constructor(
    private readonly config: ConfigService,
    private readonly stripe: StripeProvider,
    private readonly dodo: DodoProvider,
  ) {}

  /** The processor named by DEPOSIT_PROCESSOR, or null when unset/unknown. */
  resolve(): DepositSessionProvider | null {
    const configured = this.config.get<string>('DEPOSIT_PROCESSOR', '');
    if (configured === 'stripe') return this.stripe;
    if (configured === 'dodo') return this.dodo;
    return null;
  }
}
