import { Injectable, BadRequestException, ForbiddenException, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../config/prisma.service';
import { EarningsLedger, PayoutProvider as DbPayoutProvider, Prisma } from '@waitlayer/db';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { AuditService } from '../audit/audit.service';
import { PAYOUT, PayoutProvider, PayoutStatus } from '@waitlayer/shared';
import { PayPalPayoutsProvider, StripeConnectPayoutProvider, WisePayoutProvider } from './providers';

const RESERVED_PAYOUT_STATUSES = [
  PayoutStatus.REQUESTED,
  PayoutStatus.UNDER_REVIEW,
  PayoutStatus.APPROVED,
  PayoutStatus.PROCESSING,
] as PayoutStatus[];

/** Payout provider interface — each provider implements this */
export interface PayoutProviderHandler {
  readiness?(): { ok: true } | { ok: false; reason: string };
  initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }>;
  checkStatus(providerTxId: string, context?: { destination?: string }): Promise<{ status: string; paidAt?: Date }>;
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

class StubPayoutProvider implements PayoutProviderHandler {
  constructor(
    private readonly providerName: string,
    private readonly txPrefix: string,
  ) {}

  readiness(): { ok: true } | { ok: false; reason: string } {
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

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private providers: Record<string, PayoutProviderHandler>;

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private referral: ReferralService,
    private audit: AuditService,
    private config: ConfigService,
    @Inject(PayPalPayoutsProvider) private paypalPayouts: PayPalPayoutsProvider,
    @Inject(StripeConnectPayoutProvider) private stripeConnect: StripeConnectPayoutProvider,
    @Inject(WisePayoutProvider) private wise: WisePayoutProvider,
  ) {
    this.providers = {
      manual: new ManualPayoutProvider(),
      paypal_email: new PayPalEmailPayoutProvider(),
      paypal_payouts: this.paypalPayouts,
      stripe_connect: this.stripeConnect,
      payoneer: new StubPayoutProvider('Payoneer', 'payoneer'),
      wise: this.wise,
      razorpay: new StubPayoutProvider('Razorpay', 'razorpay'),
    };
  }

  private toDbPayoutProvider(provider: string): DbPayoutProvider {
    if ((Object.values(DbPayoutProvider) as string[]).includes(provider)) {
      return provider as DbPayoutProvider;
    }
    throw new BadRequestException(`Payout provider "${provider}" is not valid`);
  }

  /** Add or update a payout method for a user */
  async addPayoutMethod(userId: string, dto: {
    provider: string;
    destination: string;
    currency?: string;
  }) {
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

  private normalizePayoutMethod(dto: {
    provider: string;
    destination: string;
    currency?: string;
  }): { provider: PayoutProvider; destination: string; currency: string } {
    this.toDbPayoutProvider(dto.provider);
    const provider = dto.provider as PayoutProvider;
    const destination = dto.destination?.trim();
    if (!destination) {
      throw new BadRequestException('Payout destination is required');
    }

    const currency = dto.currency?.trim().toUpperCase() || 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('Payout currency must be a 3-letter ISO currency code');
    }

    if ([PayoutProvider.PAYPAL_EMAIL, PayoutProvider.PAYPAL_PAYOUTS, PayoutProvider.WISE].includes(provider)) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination)) {
        throw new BadRequestException(`Payout destination for ${provider} must be a recipient email`);
      }
      return { provider, destination: destination.toLowerCase(), currency };
    }

    if (provider === PayoutProvider.STRIPE_CONNECT && !/^acct_[A-Za-z0-9]+$/.test(destination)) {
      throw new BadRequestException('Stripe Connect payout destination must be a connected account id (acct_...)');
    }

    return { provider, destination, currency };
  }

  /** Get payout info for a user */
  async getPayoutInfo(userId: string) {
    const [accounts, payoutHistory, confirmedEarnings, confirmedDebits, allocatedTotal] = await Promise.all([
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
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'debit' },
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

    const availableBalance =
      (confirmedEarnings._sum.amountMinor || 0) -
      (confirmedDebits._sum.amountMinor || 0) -
      (allocatedTotal._sum.amountMinor || 0);

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

    const [available, confirmedDebits] = await Promise.all([
      this.prisma.earningsLedger.findMany({
        where: {
          userId,
          status: 'confirmed',
          entryType: 'credit',
          ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
    ]);

    const totalCreditMinor = available.reduce((sum: number, e: { amountMinor: number }) => sum + e.amountMinor, 0);
    const totalMinor = Math.max(
      0,
      totalCreditMinor - (confirmedDebits._sum.amountMinor || 0),
    );

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

        // Split partial allocations: shrink the original row to the
        // allocated slice and persist the remainder as a fresh confirmed
        // row so future payouts can still allocate against it.
        //
        // The `update` is gated by `amountMinor: entry.amountMinor` — a
        // CAS pin against the row-state snapshot we read at the top of the
        // tx. Without it, two concurrent requestPayout calls passing the
        // SAME entry id would both pass the row-update where-uniqueness
        // check, both shrink the row, and double-allocation would result.
        // UpdateMany returns count===0 when the predicate doesn't match
        // (concurrent split by another tx) — translate to BadRequest so
        // the caller retries against fresh state instead of seeing a 500
        // and silently losing allocation.
        const updateResult = await tx.earningsLedger.updateMany({
          where: { id: entry.id, amountMinor: entry.amountMinor },
          data: {
            amountMinor: allocAmount,
            // Carry the immutable fields through so the original row stays
            // a valid sibling of the remainder row.
            entryType: entry.entryType,
            status: entry.status,
          },
        });
        if (updateResult.count === 0) {
          throw new BadRequestException(
            `Earnings entry ${entry.id} changed during allocation — please retry.`,
          );
        }

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
    // Payouts move real money to an external account, so require a verified
    // email before any payout can be requested. This blocks account-takeover
    // payout theft from unverified/squatted accounts.
    if (!user.emailVerified) {
      throw new ForbiddenException('Email must be verified before requesting a payout');
    }
    // Optional hard requirement: when PAYOUT_REQUIRE_2FA=true, payouts are
    // blocked until the account has MFA enrolled. This is off by default so
    // existing developer flows are unaffected; operators enable it once 2FA
    // adoption is sufficiently broad (or per risk tier).
    if (this.config.get<string>('PAYOUT_REQUIRE_2FA') === 'true' && !user.twoFactorEnabled) {
      throw new ForbiddenException('Two-factor authentication is required before requesting a payout');
    }

    // Minimum threshold check
    if (dto.amountMinor < PAYOUT.MINIMUM_THRESHOLD_MINOR) {
      throw new BadRequestException(`Minimum payout is $${PAYOUT.MINIMUM_THRESHOLD_MINOR / 100}`);
    }

    // ── Outer pre-checks (fast rejection) ──
    const [confirmedEarnings, confirmedDebits, allocatedTotal, openFlags, account] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, status: 'confirmed', entryType: 'debit' },
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
    const available =
      (confirmedEarnings._sum.amountMinor || 0) -
      (confirmedDebits._sum.amountMinor || 0) -
      (allocatedTotal._sum.amountMinor || 0);
    if (dto.amountMinor > available) {
      throw new BadRequestException('Insufficient available earnings');
    }
    if (openFlags > 0) {
      throw new ForbiddenException('Payout blocked due to pending fraud review');
    }
    if (!account || account.userId !== userId) {
      throw new BadRequestException('Invalid payout account');
    }
    // Currency safety: a payout can only move funds in the destination
    // account's currency. Without this, a USD-denominated earnings balance
    // could be paid to a EUR account (or vice versa), producing silently
    // mis-denominated payouts. Full multi-currency ledger accounting is a
    // follow-up; this guard blocks the cross-currency path today.
    if ((account.currency ?? 'USD').toUpperCase() !== dto.currency.toUpperCase()) {
      throw new BadRequestException(
        `Payout currency ${dto.currency} does not match the payout account currency ${account.currency}`,
      );
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

      const final = await tx.payoutRequest.findUnique({
        where: { id: payoutRequest.id },
        include: { allocations: true },
      });

      // Audit: payout requested — top-tier money-movement event. Fire
      // post-commit so we don't log an audit event if the tx rolls back.
      void this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'request_payout',
        targetType: 'payout_request',
        targetId: payoutRequest.id,
        beforeSnap: {
          requestedAmountMinor: dto.amountMinor,
          currency: dto.currency,
          allocationCount: dto.earningsEntryIds?.length ?? 0,
        },
      });

      return final;
    });
  }

  /** Process an approved payout via the configured provider.
   *
   *  **TOCTOU hardening**: The `approved → processing` claim is atomic inside
   *  the same `$transaction` as the allocation-reconciliation + earnings-status
   *  checks. If any of those checks fails (partial-approval mismatch, held
   *  earnings), the entire tx rolls back — the row stays `approved` and the
   *  admin can re-assess rather than leaving it permanently stuck in `processing`.
   *
   *  The provider call happens AFTER the tx commits (outside the DB lock
   *  window). By the time `provider.initiate()` runs, the claim is irrevocably
   *  committed and at most one `processPayout` can own the row, preventing
   *  a real-money double-pay.
   */
  async processPayout(payoutId: string) {
    const preflight = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { payoutAccount: true },
    });
    if (!preflight) throw new BadRequestException('Payout request not found');
    if (preflight.status === 'approved') {
      const preflightProvider = this.providers[preflight.payoutAccount.provider];
      if (!preflightProvider) {
        throw new BadRequestException(`Payout provider "${preflight.payoutAccount.provider}" not implemented`);
      }
      const readiness = preflightProvider.readiness?.();
      if (readiness && !readiness.ok) {
        throw new BadRequestException(readiness.reason);
      }
    }

    // Atomic claim + reconciliation inside a single transaction.
    // The claim flip (`approved -> processing`) is the first write inside the
    // tx — at most one caller wins per payout row. Every subsequent check
    // (allocated-sum mismatch, held-entry guard) can throw, and if it does
    // the flip rolls back with the tx, leaving the row in `approved` for
    // retry rather than leaving it stuck in `processing` with no admin
    // recovery path (the Round 23 MED #2 partial-approval dead-end).
    const payout = await this.prisma.$transaction(async (tx) => {
      // ── CAS claim: flip the row from `approved` to `processing` within the tx ──
      const claim = await tx.payoutRequest.updateMany({
        where: { id: payoutId, status: 'approved' },
        data: { status: 'processing', processedAt: new Date() },
      });
      if (claim.count === 0) {
        // Owned by another caller or not in `approved` status. Re-read to give
        // a helpful error.
        const existing = await tx.payoutRequest.findUnique({
          where: { id: payoutId },
          select: { status: true },
        });
        if (!existing) throw new BadRequestException('Payout request not found');
        throw new BadRequestException(
          `Payout cannot be processed from status '${existing.status}'` +
          (existing.status === 'processing' ? ' (already claimed by a concurrent process)' : ''),
        );
      }

      // ── Re-read allocations + earnings entries (row-locked by the updateMany above) ──
      const pkt = await tx.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { payoutAccount: true, allocations: { include: { earningsEntry: true } } },
      });
      if (!pkt) throw new BadRequestException('Payout request not found');

      const expectedAmount = pkt.approvedAmountMinor ?? pkt.requestedAmountMinor;

      // ── Allocation-sum reconciliation ──────────────────────────
      // A partial approval (admin set approvedAmountMinor < requestedAmountMinor)
      // means the existing allocations overshoot the approved amount — we
      // must trim them here or the recon fails and leaves the payout stuck
      // in `processing` (formerly the entire recon ran OUTSIDE the tx, so
      // the flip was already committed).
      let allocations = [...pkt.allocations];
      let allocatedSum = allocations.reduce(
        (sum: number, a: { amountMinor: number }) => sum + a.amountMinor,
        0,
      );

      if (allocatedSum > expectedAmount) {
        // Trim the over-allocated slice. We delete the excess allocation
        // rows (oldest-first to keep the most recently allocated slice)
        // so the remaining sum matches `expectedAmount`.
        let overage = allocatedSum - expectedAmount;
        const removedIds = new Set<string>();
        for (let i = 0; i < allocations.length && overage > 0; i++) {
          const entry = allocations[i];
          if (entry.amountMinor <= overage) {
            // Entire allocation is excess — delete it
            await tx.payoutAllocation.delete({ where: { id: entry.id } });
            overage -= entry.amountMinor;
            allocatedSum -= entry.amountMinor;
            removedIds.add(entry.id);
          } else {
            // Shrink this allocation
            const remaining = entry.amountMinor - overage;
            await tx.payoutAllocation.update({
              where: { id: entry.id },
              data: { amountMinor: remaining },
            });
            allocatedSum -= overage;
            overage = 0;
          }
        }
        allocations = allocations.filter((a) => !removedIds.has(a.id));
      }

      if (allocatedSum !== expectedAmount) {
        throw new BadRequestException(
          `Allocation mismatch after reconciliation: allocated ${allocatedSum} but expected ${expectedAmount}. ` +
          `The payout had excess allocations that could not be trimmed — retry or reject the payout.`,
        );
      }

      // Compute effective allocations after any potential trimming above.
      const holdEntryIds = allocations.map(
        (a: { earningsEntryId: string }) => a.earningsEntryId,
      );

      // ── Race-safe vs holdEarnings / fraud flags ────────────────
      if (holdEntryIds.length > 0) {
        const notConfirmedCount = await tx.earningsLedger.count({
          where: { id: { in: holdEntryIds }, status: { not: 'confirmed' } },
        });
        if (notConfirmedCount > 0) {
          throw new BadRequestException(
            `Payout cannot be processed: ${notConfirmedCount} allocated earnings entries are no longer in 'confirmed' status (likely held by a fraud flag). Reject the payout and the developer may re-request once the entries are released.`,
          );
        }
      }

      return pkt;
    });

    const provider = this.providers[payout.payoutAccount.provider];
    if (!provider) {
      throw new BadRequestException(`Payout provider "${payout.payoutAccount.provider}" not implemented`);
    }

    const expectedAmount = payout.approvedAmountMinor ?? payout.requestedAmountMinor;

    const result = await provider.initiate({
      payoutRequestId: payout.id,
      destination: payout.payoutAccount.destination,
      amountMinor: expectedAmount,
      currency: payout.currency,
    });

    if (result.status === PayoutStatus.FAILED) {
      await this.markPayoutFailed(payout.id, {
        provider: payout.payoutAccount.provider,
        providerTxId: result.providerTxId,
        failureReason: 'Provider initiate returned failed',
      });

      return { payoutId, providerTxId: result.providerTxId, status: PayoutStatus.FAILED };
    }

    await this.prisma.payoutTransaction.create({
      data: {
        payoutRequestId: payout.id,
        provider: payout.payoutAccount.provider,
        providerTxId: result.providerTxId,
        status: 'processing',
      },
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
    // Optional cross-check fields supplied by the admin body (MarkPayoutPaidDto).
    // When present, the stored approved/requested amountMinor AND currency MUST
    // match — this catches a transposed digit / wrong-currency mark-paid before
    // the payout is irreversibly flipped. When absent (e.g. path callers that
    // only have providerTxId + paidAt), the cross-check is skipped, preserving
    // the prior behavior so webhook/automated callers don't break.
    expectedAmountMinor?: number;
    expectedCurrency?: string;
  }) {
    const payout = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: {
        payoutAccount: true,
        allocations: { include: { earningsEntry: true } },
      },
    });
    if (!payout) throw new BadRequestException('Payout not found');

    // Cross-check the admin-supplied amount/currency against the authoritative
    // stored values before transitioning. The paid amount of record is the
    // approved amount (or requested when not yet approved); the currency is
    // the payout's own currency. A mismatch is a client-side data error and
    // must surface as a 400 rather than silently marking the wrong payout.
    if (data.expectedAmountMinor !== undefined) {
      const authoritativeAmount = payout.approvedAmountMinor ?? payout.requestedAmountMinor;
      if (data.expectedAmountMinor !== authoritativeAmount) {
        throw new BadRequestException(
          `Payout amount mismatch: mark-paid body says ${data.expectedAmountMinor} but the payout is ${authoritativeAmount}`,
        );
      }
    }
    if (data.expectedCurrency !== undefined) {
      if (data.expectedCurrency.toUpperCase() !== payout.currency.toUpperCase()) {
        throw new BadRequestException(
          `Payout currency mismatch: mark-paid body says ${data.expectedCurrency} but the payout is ${payout.currency}`,
        );
      }
    }

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

      // 2. Record payout transaction. processPayout already creates the
      // in-flight provider row, so terminal transitions update that row first
      // instead of creating a duplicate `(provider, providerTxId)` pair.
      const txUpdate = await tx.payoutTransaction.updateMany({
        where: {
          payoutRequestId: payoutId,
          provider: payout.payoutAccount.provider,
          providerTxId: data.providerTxId,
          status: { in: [PayoutStatus.APPROVED, PayoutStatus.PROCESSING] },
        },
        data: {
          status: PayoutStatus.PAID,
          paidAt: paidAtDate,
          failureReason: null,
        },
      });

      if (txUpdate.count === 0) {
        const existingTx = await tx.payoutTransaction.findFirst({
          where: {
            provider: payout.payoutAccount.provider,
            providerTxId: data.providerTxId,
          },
          select: { id: true, payoutRequestId: true, status: true },
        });

        if (existingTx) {
          if (existingTx.payoutRequestId !== payoutId) {
            throw new BadRequestException(
              `Provider transaction ${data.providerTxId} is already attached to another payout`,
            );
          }
          if (existingTx.status !== PayoutStatus.PAID) {
            throw new BadRequestException(
              `Provider transaction ${data.providerTxId} cannot be marked paid from status '${existingTx.status}'`,
            );
          }
        } else {
          await tx.payoutTransaction.create({
            data: {
              payoutRequestId: payoutId,
              provider: payout.payoutAccount.provider,
              providerTxId: data.providerTxId,
              status: PayoutStatus.PAID,
              paidAt: paidAtDate,
            },
          });
        }
      }

      // 3. Mark only the allocated / confirmed earnings as paid.
      // `updateMany where status: 'confirmed'` is the per-row TOCTOU guard:
      // an entry that was already paid by a concurrent caller won't match.
      if (earningsIds.length > 0) {
        await tx.earningsLedger.updateMany({
          where: { id: { in: earningsIds }, status: 'confirmed' },
          data: { status: 'paid' },
        });

        // Authoritative post-check: a concurrent fraud `holdEarnings` could have
        // flipped one or more allocated entries from `confirmed` → `held`
        // between the snapshot read (line 590) and the CAS above. The
        // conditional `updateMany` silently SKIPS those rows (no matching
        // `confirmed` row), so without this check the payout would be marked
        // `paid` while the held entries stay `held` — money left the platform
        // but the developer's earnings entry is orphaned in `held`. When the
        // flag later resolves as a false positive, `releaseEarnings` flips the
        // held entry back to `confirmed` and the developer can withdraw it
        // AGAIN (double-spend). Refuse the paid transition when any allocated
        // entry was held out — the admin re-runs `markPayoutPaid` after the
        // hold clears, or cancels the payout.
        const paidCount = await tx.earningsLedger.aggregate({
          where: { id: { in: earningsIds }, status: 'paid' },
          _count: { _all: true },
        });
        if (paidCount._count._all !== earningsIds.length) {
          // Throw inside the transaction → rolls back the payoutRequest → paid
          // flip AND the payoutTransaction row. The payout stays in its prior
          // state ('approved'/'processing') so the operation can be retried.
          throw new BadRequestException(
            `Payout ${payoutId} cannot be marked paid: ${earningsIds.length - paidCount._count._all} allocated earnings entry/entries are no longer in 'confirmed' status (likely held by a fraud investigation). Resolve the fraud flag and retry.`,
          );
        }
      }

      return tx.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    });

    // After successfully marking as paid, check referral rewards.
    // Use the transaction result, not the stale outer `payout` snapshot — if the
    // tx found the payout already paid (count === 0), don't re-fire the reward.
    const paidPayout = result;
    if (paidPayout?.status === 'paid') {
      this.referral.processReferralRewards(paidPayout.userId).catch((err) => {
        // A failed referral reward has two possible paths:
        //  (a) transient DB error — log + operator can retry; or
        //  (b) referrer pair already credited (idempotent-P2002 catch = no-op).
        //  Log both so the first-payout-referral path isn't silent in its log.
        this.logger.error(
          `Referral reward processing failed for userId=${paidPayout.userId}: ` +
          `${err instanceof Error ? err.message : err}`,
        );
      });
    }

    return paidPayout ?? this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { allocations: true },
    });
  }

  /** Mark a provider payout as failed and un-reserve its allocations.
   *
   * Used by provider initiation failures, webhook failures, and polling cron
   * failures. Keeping the transition centralized prevents the failure paths
   * from drifting on the important invariants:
   *   - only `approved` / `processing` payouts may transition to `failed`;
   *   - the provider transaction is marked failed, or created if the failure
   *     happened before a processing transaction row existed;
   *   - payout allocations are deleted so confirmed earnings become available
   *     for a fresh payout request.
   */
  async markPayoutFailed(payoutId: string, data: {
    provider: string;
    providerTxId: string;
    failureReason: string;
  }) {
    const dbProvider = this.toDbPayoutProvider(data.provider);

    return this.prisma.$transaction(async (tx) => {
      const failed = await tx.payoutRequest.updateMany({
        where: { id: payoutId, status: { in: ['approved', 'processing'] } },
        data: { status: PayoutStatus.FAILED },
      });

      if (failed.count === 0) {
        const current = await tx.payoutRequest.findUnique({
          where: { id: payoutId },
          include: { allocations: true },
        });
        if (current?.status === PayoutStatus.FAILED) return current;
        throw new BadRequestException(
          current
            ? `Payout cannot be marked failed from status '${current.status}'`
            : 'Payout not found',
        );
      }

      const txUpdate = await tx.payoutTransaction.updateMany({
        where: {
          payoutRequestId: payoutId,
          provider: dbProvider,
          providerTxId: data.providerTxId,
          status: { in: [PayoutStatus.APPROVED, PayoutStatus.PROCESSING] },
        },
        data: { status: PayoutStatus.FAILED, failureReason: data.failureReason },
      });

      if (txUpdate.count === 0) {
        const existingTx = await tx.payoutTransaction.findFirst({
          where: {
            provider: dbProvider,
            providerTxId: data.providerTxId,
          },
          select: { id: true, payoutRequestId: true, status: true },
        });

        if (existingTx) {
          if (existingTx.payoutRequestId !== payoutId) {
            throw new BadRequestException(
              `Provider transaction ${data.providerTxId} is already attached to another payout`,
            );
          }
          if (existingTx.status !== PayoutStatus.FAILED) {
            throw new BadRequestException(
              `Provider transaction ${data.providerTxId} cannot be marked failed from status '${existingTx.status}'`,
            );
          }
        } else {
          await tx.payoutTransaction.create({
            data: {
              payoutRequestId: payoutId,
              provider: dbProvider,
              providerTxId: data.providerTxId,
              status: PayoutStatus.FAILED,
              failureReason: data.failureReason,
            },
          });
        }
      }

      await tx.payoutAllocation.deleteMany({ where: { payoutRequestId: payoutId } });

      return tx.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    });
  }

  /** Expose the provider map so the payout cron can check status on processing payouts */
  getProvider(providerName: string): PayoutProviderHandler | undefined {
    return this.providers[providerName];
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
