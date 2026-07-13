import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutProvider as DbPayoutProvider, Prisma } from '@waitlayer/db';
import {
  isProviderSupportedForCurrency,
  PAYOUT_PROVIDERS,
  PayoutProvider,
  payoutProviderLaunchStatus,
} from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { PayoutProviderHandler, StubPayoutProvider } from './payout.constants';

export class PayoutMethodTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare config: ConfigService;
  declare providers: Record<string, PayoutProviderHandler>;

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
    const { provider, destination, currency } = this.normalizePayoutMethod(dto);
    const method = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Deactivate the current active method and create the replacement atomically.
      // The DB enforces at most one active account per user/provider with a
      // partial unique index, while retaining any number of inactive historical
      // destinations for audit.
      await tx.payoutAccount.updateMany({
        where: { userId, provider, isActive: true },
        data: { isActive: false },
      });
      return tx.payoutAccount.create({
        data: {
          userId,
          provider,
          destination,
          currency,
        },
      });
    });
    // Audit: payout method added (destination-change is security-relevant)
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'add_payout_method',
      targetType: 'payout_account',
      targetId: method.id,
      beforeSnap: { provider, currency },
    });
    return method;
  }

  normalizePayoutMethod(dto: { provider: string; destination: string; currency?: string }): {
    provider: PayoutProvider;
    destination: string;
    currency: string;
  } {
    this.toDbPayoutProvider(dto.provider);
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
    if (provider === PayoutProvider.STRIPE_CONNECT && !/^acct_[A-Za-z0-9]+$/.test(destination)) {
      throw new BadRequestException(
        'Stripe Connect payout destination must be a connected account id (acct_...)',
      );
    }
    return { provider, destination, currency };
  }

  /** Expose the provider map so the payout cron can check status on processing payouts */
  getProvider(providerName: string): PayoutProviderHandler | undefined {
    return this.providers[providerName];
  }

  getPayoutProviderAvailability() {
    const overrides = this.config.get<string>('WAITLAYER_PAYOUT_PROVIDER_STATUS');
    return {
      providers: PAYOUT_PROVIDERS.map((info) => {
        const handler = this.providers[info.provider];
        const readiness = handler?.readiness?.();
        const launchStatus = payoutProviderLaunchStatus(info.provider, overrides);
        const isStub = handler instanceof StubPayoutProvider;
        const available =
          launchStatus === 'available' && Boolean(handler) && !isStub && readiness?.ok !== false;
        const reason =
          launchStatus === 'coming_soon'
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
    };
  }
}
