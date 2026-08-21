import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutProvider as DbPayoutProvider, Prisma } from '@ateva/db';
import {
  isProviderSupportedForCurrency,
  PAYOUT_PROVIDERS,
  PayoutProvider,
  payoutProviderLaunchStatus,
} from '@ateva/shared';

import { AuditService } from '../audit/audit.service';
import {
  encryptPayoutDestination,
  hmacPayoutDestination,
  safeDisplayDestination,
  tryDecryptPayoutDestination,
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout-account:' + userId}))`;
      const activeAccount = await tx.payoutAccount.findFirst({
        where: { userId, provider, isActive: true },
        select: { id: true, isFrozen: true, initiationPayoutId: true },
      });
      if (activeAccount?.isFrozen) {
        throw new ConflictException(
          'Cannot replace a payout method frozen by an operator; ask an administrator to review it first',
        );
      }
      if (activeAccount?.initiationPayoutId) {
        throw new ConflictException(
          'Cannot replace payout method while a provider initiation is awaiting reconciliation',
        );
      }
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
        where: {
          userId,
          provider,
          isActive: true,
          isFrozen: false,
          initiationPayoutId: null,
        },
        data: { isActive: false },
      });
      // Encrypt the destination at rest using AES-256-GCM, and compute a
      // deterministic HMAC so checkSharedPayoutDestination can detect shared
      // destinations without decrypting every account.
      const payoutAccountId = randomUUID();
      const encryptedDest = encryptPayoutDestination(destination, {
        accountId: payoutAccountId,
        userId,
        provider,
        currency,
      });
      const destHmac = hmacPayoutDestination(destination);
      const created = await tx.payoutAccount.create({
        data: {
          id: payoutAccountId,
          userId,
          provider,
          destination: encryptedDest,
          destinationHmac: destHmac,
          currency,
          encryptionMigratedAt: new Date(),
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
    // Return an explicit public shape. Never spread the Prisma row here: it
    // contains encrypted destination ciphertext, its deterministic HMAC, and
    // encryption metadata that are storage details rather than API fields.
    return {
      id: method.id,
      provider: method.provider,
      destination: safeDisplayDestination(method.destination, {
        accountId: method.id,
        userId,
        provider: method.provider,
        currency: method.currency,
      }),
      currency: method.currency,
      isVerified: method.isVerified,
      isActive: method.isActive,
      isFrozen: method.isFrozen,
      initiationPayoutId: method.initiationPayoutId,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
    };
  }

  /** Deactivate an owned payout method while preserving its audit history. */
  async removePayoutMethod(userId: string, payoutAccountId: string) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Serialize registration/removal for this user. Historical records are
      // retained; deletion means deactivation so settled payouts keep their
      // referential and audit trail.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout-account:' + userId}))`;
      const account = await tx.payoutAccount.findUnique({
        where: { id: payoutAccountId },
        select: {
          id: true,
          userId: true,
          provider: true,
          currency: true,
          isActive: true,
          isFrozen: true,
          initiationPayoutId: true,
        },
      });
      if (!account || account.userId !== userId || !account.isActive) {
        throw new NotFoundException('Active payout method not found');
      }
      if (account.isFrozen) {
        throw new ConflictException(
          'Cannot remove a payout method frozen by an operator; ask an administrator to review it first',
        );
      }
      const inFlightCount = await tx.payoutRequest.count({
        where: {
          userId,
          payoutAccountId,
          status: { in: RESERVED_PAYOUT_STATUSES },
        },
      });
      if (inFlightCount > 0 || account.initiationPayoutId) {
        throw new ConflictException(
          'Cannot remove payout method while a payout is still in progress',
        );
      }
      const deactivated = await tx.payoutAccount.updateMany({
        where: {
          id: payoutAccountId,
          userId,
          isActive: true,
          isFrozen: false,
          initiationPayoutId: null,
        },
        data: { isActive: false },
      });
      if (deactivated.count !== 1) {
        throw new ConflictException('Payout method changed concurrently; reload and try again');
      }
      await this.audit.logStrict(
        {
          actorId: userId,
          actorRole: 'developer',
          action: 'remove_payout_method',
          targetType: 'payout_account',
          targetId: payoutAccountId,
          beforeSnap: { provider: account.provider, currency: account.currency },
        },
        tx,
      );
      return { removed: true };
    });
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
    const launchOverrides = this.config.get<string>('ATEVA_PAYOUT_PROVIDER_STATUS');
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
      // The length cap is what makes this regex safe, not decoration. `.` is
      // inside `[^@\s]`, so `[^@\s]+\.[^@\s]+` can split a long run of dots
      // many ways and backtracks quadratically on attacker-chosen input. 254
      // is the RFC 5321 maximum for an address, so this rejects nothing valid
      // while bounding the match to a trivial amount of work.
      if (destination.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination)) {
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Return/refresh URL is invalid');
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException('Return/refresh URL must not contain credentials');
    }

    if (this.config.get<string>('NODE_ENV') === 'production') {
      const webBaseUrl = this.config.get<string>('WEB_BASE_URL');
      let webOrigin: string;
      try {
        webOrigin = new URL(webBaseUrl ?? '').origin;
      } catch {
        throw new BadRequestException('WEB_BASE_URL is not configured for Stripe onboarding');
      }
      if (parsed.protocol !== 'https:' || parsed.origin !== webOrigin) {
        throw new BadRequestException(
          'Return/refresh URL must use the configured production web origin',
        );
      }
      return;
    }

    const allowed = this.config.get<string>('ATEVA_STRIPE_CONNECT_RETURN_DOMAINS');
    if (!allowed) return;
    const allowedHosts = allowed.split(',').map((h) => h.trim().toLowerCase());
    if (allowedHosts.length === 0) return;
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.includes(host)) {
      throw new BadRequestException('Return/refresh URL host is not allowed');
    }
  }

  /**
   * Return the active Stripe account, if any, after proving that it is safe to
   * reuse. Callers hold the per-user payout-account advisory lock. A Stripe
   * onboarding retry must never silently replace an operator-frozen account or
   * a destination tied to reserved/ambiguous money movement.
   */
  private async reusableStripeAccount(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: string,
  ) {
    const account = await tx.payoutAccount.findFirst({
      where: { userId, provider: 'stripe_connect', isActive: true },
      select: {
        id: true,
        userId: true,
        provider: true,
        destination: true,
        currency: true,
        isFrozen: true,
        initiationPayoutId: true,
      },
    });
    if (!account) return null;
    if (account.isFrozen) {
      throw new ConflictException(
        'Stripe Connect onboarding is blocked because the current payout method is frozen by an operator',
      );
    }
    if (account.initiationPayoutId) {
      throw new ConflictException(
        'Stripe Connect onboarding is blocked while a provider initiation awaits reconciliation',
      );
    }
    const inFlightCount = await tx.payoutRequest.count({
      where: {
        userId,
        payoutAccountId: account.id,
        status: { in: RESERVED_PAYOUT_STATUSES },
      },
    });
    if (inFlightCount > 0) {
      throw new ConflictException(
        `Stripe Connect onboarding is blocked while ${inFlightCount} payout(s) are still in progress`,
      );
    }
    if (account.currency.toUpperCase() !== currency) {
      throw new ConflictException(
        `The existing Stripe Connect method uses ${account.currency}; remove it before onboarding a ${currency} method`,
      );
    }
    let accountId: string;
    try {
      accountId = tryDecryptPayoutDestination(account.destination, {
        accountId: account.id,
        userId: account.userId,
        provider: account.provider,
        currency: account.currency,
      });
    } catch {
      throw new ConflictException(
        'The existing Stripe Connect method cannot be read safely; ask an administrator to review it',
      );
    }
    if (!accountId.startsWith('acct_')) {
      throw new ConflictException(
        'The existing Stripe Connect method is invalid; ask an administrator to review it',
      );
    }
    return { payoutAccountId: account.id, accountId };
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
    const launchOverrides = this.config.get<string>('ATEVA_PAYOUT_PROVIDER_STATUS');
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

    // First reuse any durable pending/existing Stripe account. This makes link
    // refreshes idempotent and avoids creating a new remote account on every
    // browser retry.
    let persisted = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout-account:' + userId}))`;
      return this.reusableStripeAccount(tx, userId, currency);
    });

    if (!persisted) {
      let createdAccountId: string;
      try {
        const createdRemote = await (
          stripeConnect as StripeConnectPayoutProvider
        ).createConnectAccount({ userId, email });
        createdAccountId = createdRemote.accountId;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Stripe Connect onboarding failed';
        throw new BadRequestException(message);
      }

      // Persist the pending account before asking Stripe for a short-lived
      // onboarding link. If link creation fails or the process exits, the next
      // request reuses this row and the provider's stable account-creation
      // idempotency key, rather than leaving an untracked remote account.
      persisted = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout-account:' + userId}))`;
        const concurrent = await this.reusableStripeAccount(tx, userId, currency);
        if (concurrent) {
          if (concurrent.accountId !== createdAccountId) {
            throw new ConflictException(
              'A different Stripe Connect method was registered concurrently; reload before continuing',
            );
          }
          return concurrent;
        }

        const payoutAccountId = randomUUID();
        const encryptedConnectDest = encryptPayoutDestination(createdAccountId, {
          accountId: payoutAccountId,
          userId,
          provider: 'stripe_connect',
          currency,
        });
        const created = await tx.payoutAccount.create({
          data: {
            id: payoutAccountId,
            userId,
            provider: 'stripe_connect',
            destination: encryptedConnectDest,
            destinationHmac: hmacPayoutDestination(createdAccountId),
            currency,
            isVerified: false,
            encryptionMigratedAt: new Date(),
          },
        });
        await this.audit.logStrict(
          {
            actorId: userId,
            actorRole: 'developer',
            action: 'add_payout_method',
            targetType: 'payout_account',
            targetId: created.id,
            beforeSnap: { provider: 'stripe_connect', currency, pending: true },
          },
          tx,
        );
        return { payoutAccountId: created.id, accountId: createdAccountId };
      });
    }

    if (!persisted) {
      throw new ConflictException('Stripe Connect onboarding could not be persisted');
    }

    let onboardingUrl: string;
    try {
      ({ url: onboardingUrl } = await (
        stripeConnect as StripeConnectPayoutProvider
      ).createOnboardingLink({
        accountId: persisted.accountId,
        refreshUrl: dto.refreshUrl,
        returnUrl: dto.returnUrl,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Stripe Connect onboarding failed';
      throw new BadRequestException(message);
    }

    return { accountId: persisted.accountId, onboardingUrl };
  }

  async getPayoutProviderAvailability() {
    const overrides = this.config.get<string>('ATEVA_PAYOUT_PROVIDER_STATUS');
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
          const status = available
            ? ('available' as const)
            : isRuntimeBlocked
              ? ('temporarily_disabled' as const)
              : launchStatus === 'coming_soon'
                ? ('coming_soon' as const)
                : !handler || isStub
                  ? ('unimplemented' as const)
                  : ('unconfigured' as const);
          const reasonCode = available
            ? null
            : isRuntimeBlocked
              ? ('operator_disabled' as const)
              : launchStatus === 'coming_soon'
                ? ('launch_not_available' as const)
                : !handler || isStub
                  ? ('provider_unimplemented' as const)
                  : ('provider_unconfigured' as const);
          const reason = available
            ? null
            : status === 'temporarily_disabled'
              ? 'This payout provider is temporarily unavailable.'
              : status === 'coming_soon'
                ? info.note
                : status === 'unimplemented'
                  ? 'This payout provider is not available yet.'
                  : 'This payout provider is not configured for this environment.';
          return {
            provider: info.provider,
            label: info.label,
            available,
            status,
            reasonCode,
            note: info.note,
            reason,
          };
        }),
      ),
    };
  }
}
