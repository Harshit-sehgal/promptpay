import { Injectable, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PAYOUT, PayoutProvider, PayoutStatus } from '@waitlayer/shared';
import { PayPalPayoutsProvider } from './providers';

/** Payout provider interface — each provider implements this */
export interface PayoutProviderHandler {
  initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }>;
  checkStatus(providerTxId: string): Promise<{ status: string; paidAt?: Date }>;
}

/** Manual payout provider — for MVP, admin processes manually */
class ManualPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string }) {
    return { providerTxId: `manual_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(providerTxId: string) {
    return { status: 'processing' };
  }
}

/** PayPal Email payout provider — for MVP, admin sends manually to email */
class PayPalEmailPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string; destination: string }) {
    return { providerTxId: `paypal_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(providerTxId: string) {
    return { status: 'processing' };
  }
}

@Injectable()
export class PayoutService {
  private providers: Record<string, PayoutProviderHandler>;

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    @Inject(PayPalPayoutsProvider) private paypalPayouts: PayPalPayoutsProvider,
  ) {
    this.providers = {
      manual: new ManualPayoutProvider(),
      paypal_email: new PayPalEmailPayoutProvider(),
      paypal_payouts: this.paypalPayouts,
    };
  }

  /** Add or update a payout method for a user */
  async addPayoutMethod(userId: string, dto: {
    provider: string;
    destination: string;
    currency?: string;
  }) {
    // Deactivate existing methods with same provider
    await this.prisma.payoutAccount.updateMany({
      where: { userId, provider: dto.provider as any, isActive: true },
      data: { isActive: false },
    });

    return this.prisma.payoutAccount.create({
      data: {
        userId,
        provider: dto.provider as any,
        destination: dto.destination,
        currency: dto.currency || 'USD',
      },
    });
  }

  /** Get payout info for a user */
  async getPayoutInfo(userId: string) {
    const [accounts, payoutHistory, confirmedEarnings, pendingPayouts] = await Promise.all([
      this.prisma.payoutAccount.findMany({ where: { userId, isActive: true } }),
      this.prisma.payoutRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.payoutRequest.aggregate({
        where: { userId, status: { in: ['paid', 'approved', 'processing', 'requested'] as PayoutStatus[] } },
        _sum: { requestedAmountMinor: true },
      }),
    ]);

    const availableBalance = (confirmedEarnings._sum.amountMinor || 0) - (pendingPayouts._sum.requestedAmountMinor || 0);

    return {
      payoutAccounts: accounts,
      availableBalanceMinor: Math.max(0, availableBalance),
      minimumThresholdMinor: PAYOUT.MINIMUM_THRESHOLD_MINOR,
      currency: 'USD',
      payoutHistory,
    };
  }

  /** Request a payout */
  async requestPayout(userId: string, dto: {
    payoutAccountId: string;
    amountMinor: number;
    currency: string;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.status === 'restricted' || user.status === 'banned') {
      throw new ForbiddenException('Account is restricted from payouts');
    }

    // Minimum threshold check
    if (dto.amountMinor < PAYOUT.MINIMUM_THRESHOLD_MINOR) {
      throw new BadRequestException(`Minimum payout is $${PAYOUT.MINIMUM_THRESHOLD_MINOR / 100}`);
    }

    // Balance check
    const confirmedEarnings = await this.prisma.earningsLedger.aggregate({
      where: { userId, status: 'confirmed', entryType: 'credit' },
      _sum: { amountMinor: true },
    });
    const pendingPayouts = await this.prisma.payoutRequest.aggregate({
      where: { userId, status: { in: ['paid', 'approved', 'processing', 'requested'] as PayoutStatus[] } },
      _sum: { requestedAmountMinor: true },
    });
    const available = (confirmedEarnings._sum.amountMinor || 0) - (pendingPayouts._sum.requestedAmountMinor || 0);
    if (dto.amountMinor > available) {
      throw new BadRequestException('Insufficient available earnings');
    }

    // Fraud check
    const openFlags = await this.prisma.fraudFlag.count({
      where: { userId, status: 'open', severity: { in: ['high', 'critical'] } },
    });
    if (openFlags > 0) {
      throw new ForbiddenException('Payout blocked due to pending fraud review');
    }

    // Validate payout account
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: dto.payoutAccountId },
    });
    if (!account || account.userId !== userId) {
      throw new BadRequestException('Invalid payout account');
    }

    return this.prisma.payoutRequest.create({
      data: {
        userId,
        payoutAccountId: dto.payoutAccountId,
        status: 'requested',
        requestedAmountMinor: dto.amountMinor,
        currency: dto.currency,
      },
    });
  }

  /** Process an approved payout via the configured provider */
  async processPayout(payoutId: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { payoutAccount: true },
    });
    if (!payout) throw new BadRequestException('Payout request not found');
    if (payout.status !== 'approved') {
      throw new BadRequestException('Payout must be approved before processing');
    }

    const provider = this.providers[payout.payoutAccount.provider];
    if (!provider) {
      throw new BadRequestException(`Payout provider "${payout.payoutAccount.provider}" not implemented`);
    }

    const result = await provider.initiate({
      payoutRequestId: payout.id,
      destination: payout.payoutAccount.destination,
      amountMinor: payout.approvedAmountMinor || payout.requestedAmountMinor,
      currency: payout.currency,
    });

    await this.prisma.payoutTransaction.create({
      data: {
        payoutRequestId: payout.id,
        provider: payout.payoutAccount.provider,
        providerTxId: result.providerTxId,
        status: 'processing',
      },
    });

    await this.prisma.payoutRequest.update({
      where: { id: payoutId },
      data: { status: 'processing', processedAt: new Date() },
    });

    return { payoutId, providerTxId: result.providerTxId, status: 'processing' };
  }

  /** Mark a payout as paid (called by admin or webhook) */
  async markPayoutPaid(payoutId: string, data: {
    providerTxId: string;
    paidAt: string;
  }) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new BadRequestException('Payout not found');

    const paidAtDate = new Date(data.paidAt);

    // Mark payout as paid
    await this.prisma.$transaction([
      this.prisma.payoutRequest.update({
        where: { id: payoutId },
        data: { status: 'paid', paidAt: paidAtDate },
      }),
      this.prisma.payoutTransaction.create({
        data: {
          payoutRequestId: payoutId,
          provider: 'manual' as any,
          providerTxId: data.providerTxId,
          status: 'paid' as any,
          paidAt: paidAtDate,
        },
      }),
    ]);

    // Mark earning entries as paid (separate from the transaction since it returns BatchPayload)
    const earningEntries = await this.prisma.earningsLedger.findMany({
      where: {
        userId: payout.userId,
        status: 'confirmed',
        entryType: 'credit',
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    if (earningEntries.length > 0) {
      await this.ledger.markAsPaid(earningEntries.map(e => e.id));
    }

    return this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
  }

  /** Get payout history for a user */
  async getPayoutHistory(userId: string, page = 1, limit = 20) {
    const [payouts, total] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where: { userId },
        include: { payoutAccount: true, transactions: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payoutRequest.count({ where: { userId } }),
    ]);

    return { payouts, total, page, limit };
  }
}
