import { Injectable, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { EarningsLedger, Prisma } from '@waitlayer/db';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
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
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

/** PayPal Email payout provider — for MVP, admin sends manually to email */
class PayPalEmailPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string; destination: string }) {
    return { providerTxId: `paypal_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

/** Stripe Connect payout provider stub */
class StripeConnectPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string }) {
    return { providerTxId: `stripe_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

/** Payoneer payout provider stub */
class PayoneerPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string }) {
    return { providerTxId: `payoneer_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

/** Wise payout provider stub */
class WisePayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string }) {
    return { providerTxId: `wise_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

/** Razorpay payout provider stub */
class RazorpayPayoutProvider implements PayoutProviderHandler {
  async initiate(params: { payoutRequestId: string }) {
    return { providerTxId: `razorpay_${params.payoutRequestId}`, status: 'processing' };
  }
  async checkStatus(_providerTxId: string) {
    return { status: 'processing' };
  }
}

@Injectable()
export class PayoutService {
  private providers: Record<string, PayoutProviderHandler>;

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private referral: ReferralService,
    @Inject(PayPalPayoutsProvider) private paypalPayouts: PayPalPayoutsProvider,
  ) {
    this.providers = {
      manual: new ManualPayoutProvider(),
      paypal_email: new PayPalEmailPayoutProvider(),
      paypal_payouts: this.paypalPayouts,
      stripe_connect: new StripeConnectPayoutProvider(),
      payoneer: new PayoneerPayoutProvider(),
      wise: new WisePayoutProvider(),
      razorpay: new RazorpayPayoutProvider(),
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
      where: { userId, provider: dto.provider as PayoutProvider, isActive: true },
      data: { isActive: false },
    });

    return this.prisma.payoutAccount.create({
      data: {
        userId,
        provider: dto.provider as PayoutProvider,
        destination: dto.destination,
        currency: dto.currency || 'USD',
      },
    });
  }

  /** Get payout info for a user */
  async getPayoutInfo(userId: string) {
    const [accounts, payoutHistory, confirmedEarnings, allocatedTotal] = await Promise.all([
      this.prisma.payoutAccount.findMany({ where: { userId, isActive: true } }),
      this.prisma.payoutRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { allocations: true },
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.payoutAllocation.aggregate({
        where: {
          payoutRequest: {
            userId,
            status: { in: ['paid', 'approved', 'processing', 'requested'] as PayoutStatus[] },
          },
        },
        _sum: { amountMinor: true },
      }),
    ]);

    const availableBalance = (confirmedEarnings._sum.amountMinor || 0) - (allocatedTotal._sum.amountMinor || 0);

    return {
      payoutAccounts: accounts,
      availableBalanceMinor: Math.max(0, availableBalance),
      minimumThresholdMinor: PAYOUT.MINIMUM_THRESHOLD_MINOR,
      currency: 'USD',
      payoutHistory,
    };
  }

  /** Get confirmed earnings available for payout (not already allocated to another payout request) */
  async getAvailableForPayout(userId: string) {
    // Find earnings that are confirmed and not already allocated to an active payout
    const allocatedEntryIds = await this.prisma.payoutAllocation.findMany({
      where: {
        payoutRequest: {
          userId,
          status: { in: ['paid', 'approved', 'processing', 'requested'] as PayoutStatus[] },
        },
      },
      select: { earningsEntryId: true },
    });
    const excludeIds = allocatedEntryIds.map((a: { earningsEntryId: string }) => a.earningsEntryId);

    const available = await this.prisma.earningsLedger.findMany({
      where: {
        userId,
        status: 'confirmed',
        entryType: 'credit',
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const totalMinor = available.reduce((sum: number, e: { amountMinor: number }) => sum + e.amountMinor, 0);

    return {
      entries: available,
      totalMinor,
      currency: 'USD',
      count: available.length,
    };
  }

  /** Allocate specific confirmed earnings to a payout request */
  private async allocatePayoutEarnings(
    tx: Prisma.TransactionClient,
    payoutRequestId: string,
    userId: string,
    amountMinor: number,
    specificEntryIds?: string[],
  ) {
    // Fetch candidate earnings: confirmed, credited, and not already allocated
    const allocatedEntryIds = await tx.payoutAllocation.findMany({
      where: {
        payoutRequest: {
          userId,
          status: { in: ['paid', 'approved', 'processing', 'requested'] as PayoutStatus[] },
        },
      },
      select: { earningsEntryId: true },
    });
    const excludeIds = allocatedEntryIds.map((a: { earningsEntryId: string }) => a.earningsEntryId);

    let candidateEntries: EarningsLedger[];

    if (specificEntryIds && specificEntryIds.length > 0) {
      // Caller specified exact entries — validate they belong to user and are confirmed
      candidateEntries = await tx.earningsLedger.findMany({
        where: {
          id: { in: specificEntryIds },
          userId,
          entryType: 'credit',
          status: 'confirmed',
          ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });

      // Check for entries that were requested but are not eligible
      const foundIds = new Set(candidateEntries.map((e: { id: string }) => e.id));
      const invalidIds = specificEntryIds.filter(id => !foundIds.has(id));
      if (invalidIds.length > 0) {
        throw new BadRequestException(
          `Earnings entries not eligible for payout: ${invalidIds.join(', ')}`,
        );
      }
    } else {
      // Auto-select: oldest confirmed entries that are not allocated, up to the requested amount
      candidateEntries = await tx.earningsLedger.findMany({
        where: {
          userId,
          status: 'confirmed',
          entryType: 'credit',
          ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // Walk through candidates, allocating entries until we reach the requested amount
    let remaining = amountMinor;
    const allocations: { earningsEntryId: string; amountMinor: number }[] = [];

    for (const entry of candidateEntries) {
      if (remaining <= 0) break;
      const allocAmount = Math.min(entry.amountMinor, remaining);

      if (allocAmount < entry.amountMinor) {
        // Splitting required: reduce the original entry to match allocAmount,
        // and spawn a new remainder entry in the confirmed state.
        const remainder = entry.amountMinor - allocAmount;
        await tx.earningsLedger.update({
          where: { id: entry.id },
          data: { amountMinor: allocAmount },
        });

        await tx.earningsLedger.create({
          data: {
            userId: entry.userId,
            amountMinor: remainder,
            currency: entry.currency,
            entryType: entry.entryType,
            status: 'confirmed',
            description: entry.description 
              ? `${entry.description} (split remainder)` 
              : 'Remaining balance after partial payout allocation',
            idempotencyKey: `${entry.idempotencyKey || entry.id}-split-${Date.now()}`,
            createdAt: entry.createdAt, // Preserve original creation timestamp
          },
        });
      }

      allocations.push({
        earningsEntryId: entry.id,
        amountMinor: allocAmount,
      });
      remaining -= allocAmount;
    }

    if (remaining > 0) {
      throw new BadRequestException(
        `Insufficient confirmed earnings to allocate. Short by ${remaining} minor units.`,
      );
    }

    // Create allocation records
    for (const alloc of allocations) {
      await tx.payoutAllocation.create({
        data: {
          payoutRequestId,
          earningsEntryId: alloc.earningsEntryId,
          amountMinor: alloc.amountMinor,
        },
      });
    }

    return allocations;
  }

  /** Request a payout */
  async requestPayout(userId: string, dto: {
    payoutAccountId: string;
    amountMinor: number;
    currency: string;
    earningsEntryIds?: string[];
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

    // Balance check using precise allocation totals (not requestedAmountMinor)
    const [confirmedEarnings, allocatedTotal] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.payoutAllocation.aggregate({
        where: {
          payoutRequest: {
            userId,
            status: { in: ['paid', 'approved', 'processing', 'requested'] as PayoutStatus[] },
          },
        },
        _sum: { amountMinor: true },
      }),
    ]);
    const available = (confirmedEarnings._sum.amountMinor || 0) - (allocatedTotal._sum.amountMinor || 0);
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

    // Create payout request + allocations atomically
    return this.prisma.$transaction(async (tx) => {
      const payoutRequest = await tx.payoutRequest.create({
        data: {
          userId,
          payoutAccountId: dto.payoutAccountId,
          status: 'requested',
          requestedAmountMinor: dto.amountMinor,
          currency: dto.currency,
        },
      });

      await this.allocatePayoutEarnings(
        tx,
        payoutRequest.id,
        userId,
        dto.amountMinor,
        dto.earningsEntryIds,
      );

      return tx.payoutRequest.findUnique({
        where: { id: payoutRequest.id },
        include: { allocations: true },
      });
    });
  }

  /** Process an approved payout via the configured provider */
  async processPayout(payoutId: string) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { payoutAccount: true, allocations: true },
    });
    if (!payout) throw new BadRequestException('Payout request not found');
    if (payout.status !== 'approved') {
      throw new BadRequestException('Payout must be approved before processing');
    }

    const provider = this.providers[payout.payoutAccount.provider];
    if (!provider) {
      throw new BadRequestException(`Payout provider "${payout.payoutAccount.provider}" not implemented`);
    }

    // Reconcile: verify the allocated sum matches approvedAmountMinor (or requestedAmountMinor)
    const allocatedSum = payout.allocations.reduce(
      (sum: number, a: { amountMinor: number }) => sum + a.amountMinor,
      0,
    );
    const expectedAmount = payout.approvedAmountMinor ?? payout.requestedAmountMinor;
    if (allocatedSum !== expectedAmount) {
      throw new BadRequestException(
        `Allocation mismatch: allocated ${allocatedSum} but expected ${expectedAmount}`,
      );
    }

    const result = await provider.initiate({
      payoutRequestId: payout.id,
      destination: payout.payoutAccount.destination,
      amountMinor: expectedAmount,
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

  /** Mark a payout as paid (called by admin or webhook).
   *  Marks only the exact allocated earnings entries as paid, inside a single transaction. */
  async markPayoutPaid(payoutId: string, data: {
    providerTxId: string;
    paidAt: string;
  }) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: {
        payoutAccount: true,
        allocations: { include: { earningsEntry: true } },
      },
    });
    if (!payout) throw new BadRequestException('Payout not found');

    // Idempotency: already paid
    if (payout.status === 'paid') {
      return this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    }

    const paidAtDate = new Date(data.paidAt);

    // Collect the earnings entry IDs from allocations, but only those still in 'confirmed' status
    const confirmedAllocations = payout.allocations.filter(
      (a: { earningsEntry: { status: string } }) => a.earningsEntry.status === 'confirmed',
    );

    if (confirmedAllocations.length === 0 && payout.allocations.length > 0) {
      // All allocated entries already paid or not confirmed — nothing to do for earnings
      // but still mark the payout itself
    }

    const earningsIds = confirmedAllocations.map(
      (a: { earningsEntryId: string }) => a.earningsEntryId,
    );

    // Double-payout prevention: verify no allocated entry is already 'paid'
    const alreadyPaid = payout.allocations.filter(
      (a: { earningsEntry: { status: string } }) => a.earningsEntry.status === 'paid',
    );
    if (alreadyPaid.length > 0) {
      throw new BadRequestException(
        `Payout ${payoutId} has ${alreadyPaid.length} earnings entries already marked as paid — possible double payout`,
      );
    }

    // Single atomic transaction: mark payout paid + mark allocated earnings paid + record tx
    await this.prisma.$transaction(async (tx) => {
      // 1. Mark payout as paid
      await tx.payoutRequest.update({
        where: { id: payoutId },
        data: { status: 'paid', paidAt: paidAtDate },
      });

      // 2. Record payout transaction
      await tx.payoutTransaction.create({
        data: {
          payoutRequestId: payoutId,
          provider: payout.payoutAccount.provider,
          providerTxId: data.providerTxId,
          status: 'paid',
          paidAt: paidAtDate,
        },
      });

      // 3. Mark only the allocated earnings entries as paid
      if (earningsIds.length > 0) {
        await tx.earningsLedger.updateMany({
          where: { id: { in: earningsIds }, status: 'confirmed' },
          data: { status: 'paid' },
        });
      }
    });

    // After successfully marking as paid, check referral rewards (fire-and-forget)
    this.referral.processReferralRewards(payout.userId).catch(() => {
      // Silently ignore referral reward failures (production would log)
    });

    return this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { allocations: true },
    });
  }

  /** Get payout history for a user */
  async getPayoutHistory(userId: string, page = 1, limit = 20) {
    const [payouts, total] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where: { userId },
        include: { payoutAccount: true, transactions: true, allocations: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payoutRequest.count({ where: { userId } }),
    ]);

    return { payouts, total, page, limit };
  }
}
