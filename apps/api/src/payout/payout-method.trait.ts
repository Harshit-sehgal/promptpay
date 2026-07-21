import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutProvider as DbPayoutProvider, Prisma } from '@waitlayer/db';
import {
  isProviderSupportedForCurrency,
  PAYOUT_PROVIDERS,
  PayoutProvider,
  payoutProviderLaunchStatus,
} from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import {
  decryptPayoutDestination,
  encryptPayoutDestination,
  hmacPayoutDestination,
  isEncryptedDestination,
  maskPayoutDestination,
} from '../common/utils/payout-encryption';
import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { RUNTIME_CONFIG_KEYS } from '../runtime-config/runtime-config.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import {
  PayoutProviderHandler,
  RESERVED_PAYOUT_STATUSES,
  StubPayoutProvider,
} from './payout.constants';
import { StripeConnectPayoutProvider } from './providers';

export class PayoutMethodTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare config: ConfigService;
  declare runtimeConfig: RuntimeConfigService;
  declare providers: Record<string, PayoutProviderHandler>;
  declare fraudService?: FraudService;

  toDbPayoutProvider(provider: string): DbPayoutProvider {
    if ((Object.values(DbPayoutProvider) as string[]).includes(provider)) {
      return provider as DbPayoutProvider;
    }
    throw new BadRequestException(`Payout provider "${provider}" is not valid`);
  }

  /** Add or update a payout method for a user */
  async addPayoutMethod(
    userId: string,
    dto: {
      provider: string;
      destination: string;
      currency?: string;
    },
  ) {
    const { provider, destination, currency } = await this.normalizePayoutMethod(dto);
    const method = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // guard against deactivating a payout account that has
      // in-flight payout requests (requested / under_review / approved /
      // processing). Deactivating such an account permanently wedges those
      // requests — processPayout will see isActive:false and refuse, but the
      // allocations stay reserved and the developer has no API surface to
      // restore the old account. Reject the swap and tell them which payouts
      // to cancel first.
      const inFlightCount = await tx.payoutRequest.count({
        where: {
          userId,
          payoutAccount: { provider, isActive: true },
          status: { in: RESERVED_PAYOUT_STATUSES },
        },
      });
      if (inFlightCount > 0) {
        throw new ConflictException(
          `Cannot replace payout method: ${inFlightCount} active payout(s) still in progress for ${provider}. Wait for them to settle, or ask an admin to reject them first.`,
        );
      }
      // Deactivate the current active method and create the replacement atomically.
      // The DB enforces at most one active account per user/provider with a
      // partial unique index, while retaining any number of inactive historical
      // destinations for audit.
      await tx.payoutAccount.updateMany({
        where: { userId, provider, isActive: true },
        data: { isActive: false },
      });
      // Encrypt the destination at rest using AES-256-GCM, and compute a
      // deterministic HMAC so checkSharedPayoutDestination can detect shared
      // destinations without decrypting every account.
      const encryptedDest = encryptPayoutDestination(destination);
      const destHmac = hmacPayoutDestination(destination);
      const created = await tx.payoutAccount.create({
        data: {
          userId,
          provider,
          destination: encryptedDest,
          destinationHmac: destHmac,
          currency,
        },
      });
      // Audit INSIDE the transaction: a payout destination change is a
      // security-relevant money-flow gate. If the audit cannot be written the
      // change must not commit, and if the transaction rolls back no audit
      // row is left behind.
      await this.audit.logStrict(
        {
          actorId: userId,
          actorRole: 'developer',
          action: 'add_payout_method',
          targetType: 'payout_account',
          targetId: created.id,
          beforeSnap: { provider, currency },
        },
        tx,
      );
      return created;
    });
    // Non-blocking fraud signal: shared payout destination across users.
    // Uses the deterministic HMAC so the check works without decrypting every
    // account's destination. Pre-compute the HMAC here and pass it so the
    // fraud service can query by destinationHmac directly.
    const destHmacForFraud = hmacPayoutDestination(destination);
    void this.fraudService
      ?.checkSharedPayoutDestination(userId, destination, destHmacForFraud)
      .catch(() => undefined);
    return method;
  }

  async normalizePayoutMethod(dto: {
    provider: string;
    destination: string;
    currency?: string;
  }): Promise<{
    provider: PayoutProvider;
    destination: string;
    currency: string;
  }> {
    this.toDbPayoutProvider(dto.provider);
    if (!(await this.runtimeConfig.isProviderEnabled(dto.provider))) {
      throw new BadRequestException(`Payout provider "${dto.provider}" is currently disabled`);
    }
    // Reject providers that have no real PSP integration. `payoneer` and
    // `razorpay` are registered only as `StubPayoutProvider` (whose `initiate`
    // throws in production) and must never be persisted as a payout account —
    // otherwise the failure surfaces only at payout time instead of at
    // registration. The web client already hides them; this guard closes the
    // API-side gap for any direct caller. (See audit gap A.)
    if (this.providers[dto.provider] instanceof StubPayoutProvider) {
      throw new BadRequestException(
        `Payout provider "${dto.provider}" is not available for registration.`,
      );
    }
    const launchOverrides = this.config.get<string>('WAITLAYER_PAYOUT_PROVIDER_STATUS');
    if (payoutProviderLaunchStatus(dto.provider, launchOverrides) === 'coming_soon') {
      throw new BadRequestException(
        `Payout provider "${dto.provider}" is not available for registration (launch status: coming_soon).`,
      );
    }
    const readiness = this.providers[dto.provider]?.readiness?.();
    if (readiness && !readiness.ok) {
      throw new BadRequestException(
        `Payout provider "${dto.provider}" is not available for registration: ${readiness.reason}`,
      );
    }
    const provider = dto.provider as PayoutProvider;
    const destination = dto.destination?.trim();
    if (!destination) {
      throw new BadRequestException('Payout destination is required');
    }
    const currency = dto.currency?.trim().toUpperCase() || 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('Payout currency must be a 3-letter ISO currency code');
    }
    if (!isProviderSupportedForCurrency(provider, currency)) {
      throw new BadRequestException(
        `Payout provider "${provider}" cannot settle payouts in ${currency}`,
      );
    }
    if (
      [PayoutProvider.PAYPAL_EMAIL, PayoutProvider.PAYPAL_PAYOUTS, PayoutProvider.WISE].includes(
        provider,
      )
    ) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination)) {
        throw new BadRequestException(
          `Payout destination for ${provider} must be a recipient email`,
        );
      }
      return { provider, destination: destination.toLowerCase(), currency };
    }
    if (provider === PayoutProvider.STRIPE_CONNECT) {
      // Stripe Connect accounts must be created server-side via the onboarding
      // flow (`createStripeConnectOnboarding`) to guarantee Stripe account
      // ownership. Accepting an arbitrary `acct_*` string here would let any
      // developer register someone else's Stripe Connected account as their
      // payout destination — a direct money-steal vector once an admin later
      // verifies it.
      throw new BadRequestException(
        'Stripe Connect accounts must be added via the onboarding flow, not manually.',
      );
    }
    return { provider, destination, currency };
  }

  /** Expose the provider map so the payout cron can check status on processing payouts */
  getProvider(providerName: string): PayoutProviderHandler | undefined {
    return this.providers[providerName];
  }

  /**
   * Create a Stripe Connect Express account for the developer and return an
   * onboarding URL. The payout account is persisted in a pending state; it is
   * activated/verified after the developer completes onboarding and Stripe
   * sends an account.updated webhook (or the return redirect is validated).
   */
  private validateReturnUrl(url: string): void {
    const allowed = this.config.get<string>('WAITLAYER_STRIPE_CONNECT_RETURN_DOMAINS');
    if (!allowed) return;
    const allowedHosts = allowed.split(',').map((h) => h.trim().toLowerCase());
    if (allowedHosts.length === 0) return;
    const host = new URL(url).hostname.toLowerCase();
    if (!allowedHosts.includes(host)) {
      throw new BadRequestException('Return/refresh URL host is not allowed');
    }
  }

  async createStripeConnectOnboarding(
    userId: string,
    email: string,
    dto: { refreshUrl: string; returnUrl: string; currency?: string },
  ): Promise<{ accountId: string; onboardingUrl: string }> {
    const currency = dto.currency?.trim().toUpperCase() || 'USD';

    // Enforce the same runtime provider gates used when adding a payout method.
    if (!(await this.runtimeConfig.isProviderEnabled('stripe_connect'))) {
      throw new BadRequestException('Payout provider "stripe_connect" is currently disabled');
    }
    const launchOverrides = this.config.get<string>('WAITLAYER_PAYOUT_PROVIDER_STATUS');
    if (payoutProviderLaunchStatus('stripe_connect', launchOverrides) === 'coming_soon') {
      throw new BadRequestException(
        'Payout provider "stripe_connect" is not available for registration (launch status: coming_soon).',
      );
    }

    const stripeConnect = this.providers['stripe_connect'];
    if (!stripeConnect) {
      throw new BadRequestException('Stripe Connect provider is not available');
    }
    const readiness = stripeConnect.readiness?.();
    if (readiness && !readiness.ok) {
      throw new BadRequestException(readiness.reason);
    }

    if (!isProviderSupportedForCurrency('stripe_connect' as PayoutProvider, currency)) {
      throw new BadRequestException(
        `Payout provider "stripe_connect" cannot settle payouts in ${currency}`,
      );
    }

    this.validateReturnUrl(dto.refreshUrl);
    this.validateReturnUrl(dto.returnUrl);

    let accountId: string;
    let onboardingUrl: string;
    try {
      ({ accountId } = await (stripeConnect as StripeConnectPayoutProvider).createConnectAccount({
        userId,
        email,
      }));
      ({ url: onboardingUrl } = await (
        stripeConnect as StripeConnectPayoutProvider
      ).createOnboardingLink({
        accountId,
        refreshUrl: dto.refreshUrl,
        returnUrl: dto.returnUrl,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Stripe Connect onboarding failed';
      throw new BadRequestException(message);
    }

    // Persist the pending payout account. It is not verified until Stripe
    // confirms onboarding completion.
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.payoutAccount.updateMany({
        where: { userId, provider: 'stripe_connect', isActive: true },
        data: { isActive: false },
      });
      const encryptedConnectDest = encryptPayoutDestination(accountId);
      const connectDestHmac = hmacPayoutDestination(accountId);
      const created = await tx.payoutAccount.create({
        data: {
          userId,
          provider: 'stripe_connect',
          destination: encryptedConnectDest,
          destinationHmac: connectDestHmac,
          currency,
          isVerified: false,
        },
      });
      // Audit INSIDE the transaction so a Stripe Connect onboarding record is
      // only persisted together with its audit trail.
      await this.audit.logStrict(
        {
          actorId: userId,
          actorRole: 'developer',
          action: 'add_payout_method',
          targetType: 'payout_account',
          targetId: accountId,
          beforeSnap: { provider: 'stripe_connect', currency, pending: true },
        },
        tx,
      );
      return created;
    });

    return { accountId, onboardingUrl };
  }

  async getPayoutProviderAvailability() {
    const overrides = this.config.get<string>('WAITLAYER_PAYOUT_PROVIDER_STATUS');
    const blockedProviders = await this.runtimeConfig.getStringArray(
      RUNTIME_CONFIG_KEYS.BLOCKED_PAYOUT_PROVIDERS,
      [],
    );
    return {
      providers: await Promise.all(
        PAYOUT_PROVIDERS.map(async (info) => {
          const handler = this.providers[info.provider];
          const readiness = handler?.readiness?.();
          const launchStatus = payoutProviderLaunchStatus(info.provider, overrides);
          const isStub = handler instanceof StubPayoutProvider;
          const isRuntimeBlocked = blockedProviders.includes(info.provider);
          const available =
            !isRuntimeBlocked &&
            launchStatus === 'available' &&
            Boolean(handler) &&
            !isStub &&
            readiness?.ok !== false;
          const reason = isRuntimeBlocked
            ? 'Provider is temporarily disabled by operator.'
            : launchStatus === 'coming_soon'
              ? info.note
              : !handler || isStub
                ? 'Provider integration is not implemented.'
                : readiness && !readiness.ok
                  ? readiness.reason
                  : null;
          return {
            provider: info.provider,
            label: info.label,
            status: available ? ('available' as const) : ('coming_soon' as const),
            note: info.note,
            reason,
          };
        }),
      ),
    };
  }
}
