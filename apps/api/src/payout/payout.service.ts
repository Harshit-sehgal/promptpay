import { Injectable, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { EarningsLedger, Prisma } from '@waitlayer/db';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { PAYOUT, PayoutProvider, PayoutStatus } from '@waitlayer/shared';
import { PayPalPayoutsProvider } from './providers';

const RESERVED_PAYOUT_STATUSES = [
  PayoutStatus.REQUESTED,
  PayoutStatus.UNDER_REVIEW,
  PayoutStatus.APPROVED,
  PayoutStatus.PROCESSING,
] as PayoutStatus[];

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
            status: { in: RESERVED_PAYOUT_STATUSES },
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
          status: { in: RESERVED_PAYOUT_STATUSES },
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
          status: { in: RESERVED_PAYOUT_STATUSES },
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
        const remainder = entry.amountMinor - allocAmount;

        // Split partial allocations so the allocated row can be marked paid
        // exactly, while the remaining confirmed row stays available later.
        await tx.earningsLedger.update({
          where: { id: entry.id },
          data: { amountMinor: allocAmount },
        });

        await tx.earningsLedger.create({
          data: {
            userId: entry.userId,
            campaignId: entry.campaignId,
            impressionId: entry.impressionId,
            clickId: entry.clickId,
            entryType: entry.entryType,
            status: entry.status,
            amountMinor: remainder,
            currency: entry.currency,
            availableAt: entry.availableAt,
            idempotencyKey: `payout-remainder-${payoutRequestId}-${entry.id}`,
            description: entry.description,
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

    // Create allocation records. The `@@unique([earningsEntryId])` index is the
    // DB floor that prevents two concurrent requestPayout calls from allocating
    // the same earnings entry: the loser re-read eligible entries inside the tx
    // but under READ COMMITTED the allocations table read happens before the
    // winner commits, so it only learns of the collision from the unique
    // constraint. Catch P2002 and surface a clean BadRequestException instead
    // of leaking a raw Prisma error (→ opaque 500) to the client.
    for (const alloc of allocations) {
      try {
        await tx.payoutAllocation.create({
          data: {
            payoutRequestId,
            earningsEntryId: alloc.earningsEntryId,
            amountMinor: alloc.amountMinor,
          },
        });
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BadRequestException(
            'These earnings were just allocated to another payout. Please retry.',
          );
        }
        throw err;
      }
    }

    return allocations;
  }

  /** Request a payout.
   *
   *  The availability computation, fraud check, and account validation happen
   *  **both** outside AND inside the transaction. The outer pass acts as a
   *  pre-filter (avoiding expensive tx work when the user is clearly blocked),
   *  but the authoritative re-check inside the $transaction closes the TOCTOU
   *  window between the outer balance snapshot and the allocation. Two concurrent
   *  requestPayout calls that both read the same outer-available will race inside
   *  the tx; the call that allocates first exhausts capacity and causes the
   *  second to fail `Insufficient confirmed earnings to allocate` inside
   *  allocatePayoutEarnings (which re-reads eligible entries inside the tx).
   */
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

    // ── Outer pre-checks (fast rejection) ──
    const [confirmedEarnings, allocatedTotal, openFlags, account] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.payoutAllocation.aggregate({
        where: {
          payoutRequest: {
            userId,
            status: { in: RESERVED_PAYOUT_STATUSES },
          },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.fraudFlag.count({
        where: { userId, status: 'open', severity: { in: ['high', 'critical'] } },
      }),
      this.prisma.payoutAccount.findUnique({
        where: { id: dto.payoutAccountId },
      }),
    ]);
    const available = (confirmedEarnings._sum.amountMinor || 0) - (allocatedTotal._sum.amountMinor || 0);
    if (dto.amountMinor > available) {
      throw new BadRequestException('Insufficient available earnings');
    }
    if (openFlags > 0) {
      throw new ForbiddenException('Payout blocked due to pending fraud review');
    }
    if (!account || account.userId !== userId) {
      throw new BadRequestException('Invalid payout account');
    }

    // ── Authoritative allocation inside a transaction ──
    // allocatePayoutEarnings re-reads eligible entries inside the tx (with
    // allocated-entry exclusions bound to RESERVED_PAYOUT_STATUSES), so two
    // concurrent payouts cannot double-allocate the same entry. The unique
    // index on `payout_allocations.earningsEntryId` is the DB floor.
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
   *
   *  **State-machine guard:** Only `approved` or `processing` payouts may be
   *  marked paid. A `requested`/`under_review` payout has not been authorized
   *  via `processPayout`; a `rejected`/`cancelled`/`failed` payout has been
   *  explicitly terminated. Accepting any non-`paid` status here would let a
   *  webhook (or admin) pay out a rejected request, bypassing provider
   *  initiation and the allocation-reconciliation in `processPayout`.
   *
   *  **TOCTOU hardening:** The outer read is an optimization (skip the tx for
   *  already-paid). The authoritative guard runs **inside** the transaction:
   *  an atomic conditional `updateMany where status in ('approved','processing')`
   *  ensures at most one caller flips to `paid`. Two concurrent callers both
   *  read a non-terminal status and both enter the tx; only one wins the
   *  conditional UPDATE (count === 1), the loser sees count === 0 and re-reads
   *  the row — if it is now `paid` it returns idempotently, otherwise it
   *  throws (a concurrent transition to a *different* terminal state).
   */
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

    // Idempotency fast-path: if already paid, return immediately
    if (payout.status === 'paid') {
      return this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    }

    // Reject non- payable states up front with a clear error. `approved` and
    // `processing` are the only legal pre-states; anything else is either not
    // yet authorized or already terminally closed.
    if (payout.status !== 'approved' && payout.status !== 'processing') {
      throw new BadRequestException(
        `Payout cannot be marked paid from status '${payout.status}' (must be approved or processing)`,
      );
    }

    const paidAtDate = new Date(data.paidAt);

    // Collect the earnings entry IDs from allocations, but only those still in
    // 'confirmed' status. This snapshot is a best-guess — the inner tx will
    // re-check via `updateMany where status: 'confirmed'`.
    const confirmedAllocations = payout.allocations.filter(
      (a: { earningsEntry: { status: string } }) => a.earningsEntry.status === 'confirmed',
    );

    const earningsIds = confirmedAllocations.map(
      (a: { earningsEntryId: string }) => a.earningsEntryId,
    );

    // Single atomic transaction with an authoritative TOCTOU guard.
    // The payout-row conditional `update where status in ('approved','processing')`
    // ensures that at most one caller flips the state from a legal pre-state;
    // the loser (count === 0) re-reads to decide idempotent-return vs. throw.
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Atomic conditional flip: only from a payable pre-state.
      const paidUpdate = await tx.payoutRequest.updateMany({
        where: { id: payoutId, status: { in: ['approved', 'processing'] } },
        data: { status: 'paid', paidAt: paidAtDate },
      });

      if (paidUpdate.count === 0) {
        // Lost the race. Re-read to distinguish:
        //  (a) another caller already set it to `paid` → idempotent return,
        //  (b) a concurrent transition moved it to a different terminal
        //      state (rejected/cancelled/failed) → throw so the caller knows
        //      the payout was not paid by this call.
        const current = await tx.payoutRequest.findUnique({
          where: { id: payoutId },
          include: { allocations: true },
        });
        if (current?.status === 'paid') {
          return current;
        }
        throw new BadRequestException(
          `Payout ${payoutId} is no longer in a payable state (now '${current?.status ?? 'missing'}')`,
        );
      }

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

      // 3. Mark only the allocated / confirmed earnings as paid.
      // `updateMany where status: 'confirmed'` is the per-row TOCTOU guard:
      // an entry that was already paid by a concurrent caller won't match.
      if (earningsIds.length > 0) {
        await tx.earningsLedger.updateMany({
          where: { id: { in: earningsIds }, status: 'confirmed' },
          data: { status: 'paid' },
        });
      }

      return tx.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    });

    // After successfully marking as paid, check referral rewards (fire-and-forget).
    // Use the transaction result, not the stale outer `payout` snapshot — if the
    // tx found the payout already paid (count === 0), don't re-fire the reward.
    const paidPayout = result;
    if (paidPayout?.status === 'paid') {
      this.referral.processReferralRewards(paidPayout.userId).catch(() => {
        // Silently ignore referral reward failures (production would log)
      });
    }

    return paidPayout ?? this.prisma.payoutRequest.findUnique({
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
