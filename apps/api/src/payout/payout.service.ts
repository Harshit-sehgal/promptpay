import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EarningsLedger, PayoutProvider as DbPayoutProvider, Prisma } from '@waitlayer/db';
import {
  isProviderSupportedForCurrency,
  PAYOUT,
  payoutMinimumMinor,
  PayoutProvider,
  PayoutStatus,
} from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { providerBreaker, withTimeout } from '../common/utils/provider-resilience';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReferralService } from '../referral/referral.service';
import { PayoutProviderUnsafeFailure } from './payout-provider.errors';
import {
  PayPalPayoutsProvider,
  StripeConnectPayoutProvider,
  WisePayoutProvider,
} from './providers';

const RESERVED_PAYOUT_STATUSES = [
  PayoutStatus.REQUESTED,
  PayoutStatus.UNDER_REVIEW,
  PayoutStatus.APPROVED,
  PayoutStatus.PROCESSING,
] as PayoutStatus[];
const AVAILABLE_ENTRIES_DEFAULT_LIMIT = 100;
const AVAILABLE_ENTRIES_MAX_LIMIT = 500;
const ALLOCATION_QUERY_PAGE_SIZE = 500;

function boundedPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/** Payout provider interface — each provider implements this */
export interface PayoutProviderHandler {
  readiness?(): { ok: true } | { ok: false; reason: string };
  initiate(params: {
    payoutRequestId: string;
    destination: string;
    amountMinor: number;
    currency: string;
  }): Promise<{ providerTxId: string; status: string }>;
  checkStatus(
    providerTxId: string,
    context?: { destination?: string },
  ): Promise<{ status: string; paidAt?: Date }>;
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

  private addCurrencyAmount(
    totals: Record<string, number>,
    currency: string | null | undefined,
    amountMinor: number,
  ) {
    const key = (currency || 'USD').toUpperCase();
    totals[key] = (totals[key] ?? 0) + amountMinor;
  }

  private availableCurrencyTotals(totals: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
      Object.entries(totals).map(([currency, amountMinor]) => [currency, Math.max(0, amountMinor)]),
    );
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

  /** Get payout info for a user */
  async getPayoutInfo(userId: string) {
    // Each sub-query is isolated so a single transient DB failure (e.g. one
    // overloaded index or a dead connection mid-batch) doesn't 500 the whole
    // response. A failed query yields an empty/default result for that slice
    // and is logged; the remaining slices still render.
    const safe = async <T>(fn: () => Promise<T>, label: string, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err: unknown) {
        this.logger.warn(
          `getPayoutInfo: sub-query "${label}" failed: ${err instanceof Error ? err.message : err}`,
        );
        return fallback;
      }
    };

    const [
      accounts,
      payoutHistory,
      confirmedEarnings,
      confirmedDebits,
      allocatedRows,
      userSecurity,
    ] = await Promise.all([
      safe(
        () =>
          this.prisma.payoutAccount.findMany({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'desc' },
          }),
        'accounts',
        [],
      ),
      safe(
        () =>
          this.prisma.payoutRequest.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { allocations: true },
          }),
        'payoutHistory',
        [],
      ),
      safe(
        () =>
          this.prisma.earningsLedger.groupBy({
            by: ['currency'],
            where: { userId, status: 'confirmed', entryType: 'credit' },
            _sum: { amountMinor: true },
          }),
        'confirmedEarnings',
        [],
      ),
      safe(
        () =>
          this.prisma.earningsLedger.groupBy({
            by: ['currency'],
            where: { userId, status: 'confirmed', entryType: 'debit' },
            _sum: { amountMinor: true },
          }),
        'confirmedDebits',
        [],
      ),
      safe(
        () =>
          this.prisma.$queryRaw<Array<{ currency: string; amountMinor: bigint | number | null }>>`
            SELECT e."currency" AS "currency", COALESCE(SUM(pa."amountMinor"), 0)::bigint AS "amountMinor"
            FROM "payout_allocations" pa
            INNER JOIN "payout_requests" pr ON pr."id" = pa."payoutRequestId"
            INNER JOIN "earnings_ledger" e ON e."id" = pa."earningsEntryId"
            WHERE pr."userId" = ${userId}
              AND pr."status" IN (${Prisma.join(RESERVED_PAYOUT_STATUSES)})
            GROUP BY e."currency"
          `,
        'allocatedRows',
        [],
      ),
      safe(
        () =>
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorEnabled: true },
          }),
        'userSecurity',
        null,
      ),
    ]);

    const rawBalancesByCurrency: Record<string, number> = {};
    for (const row of confirmedEarnings) {
      this.addCurrencyAmount(rawBalancesByCurrency, row.currency, row._sum.amountMinor ?? 0);
    }
    for (const row of confirmedDebits) {
      this.addCurrencyAmount(rawBalancesByCurrency, row.currency, -(row._sum.amountMinor ?? 0));
    }
    for (const row of allocatedRows) {
      this.addCurrencyAmount(rawBalancesByCurrency, row.currency, -Number(row.amountMinor ?? 0));
    }
    const availableBalanceByCurrency = this.availableCurrencyTotals(rawBalancesByCurrency);
    const currency = (accounts[0]?.currency || 'USD').toUpperCase();

    return {
      payoutAccounts: accounts,
      availableBalanceMinor: availableBalanceByCurrency[currency] ?? 0,
      availableBalanceByCurrency,
      minimumThresholdMinor: PAYOUT.MINIMUM_THRESHOLD_MINOR,
      currency,
      payoutHistory,
      requiresTwoFactorForPayout: this.config.get<string>('PAYOUT_REQUIRE_2FA') === 'true',
      twoFactorEnabled: userSecurity?.twoFactorEnabled ?? false,
    };
  }

  /** Get confirmed earnings available for payout (not already allocated to another payout request) */
  async getAvailableForPayout(userId: string, params: { page?: number; limit?: number } = {}) {
    const page = boundedPositiveInt(params.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = boundedPositiveInt(
      params.limit,
      AVAILABLE_ENTRIES_DEFAULT_LIMIT,
      AVAILABLE_ENTRIES_MAX_LIMIT,
    );
    const unallocatedCreditWhere: Prisma.EarningsLedgerWhereInput = {
      userId,
      status: 'confirmed',
      entryType: 'credit',
      payoutAllocations: {
        none: {
          payoutRequest: {
            userId,
            status: { in: RESERVED_PAYOUT_STATUSES },
          },
        },
      },
    };

    const [availableCredits, confirmedDebits, entryRows, totalEntries] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: unallocatedCreditWhere,
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['currency'],
        where: { userId, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.findMany({
        where: unallocatedCreditWhere,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit + 1,
      }),
      this.prisma.earningsLedger.count({ where: unallocatedCreditWhere }),
    ]);
    const available = entryRows.slice(0, limit);

    const totalsByCurrency: Record<string, number> = {};
    for (const row of availableCredits) {
      this.addCurrencyAmount(totalsByCurrency, row.currency, row._sum.amountMinor ?? 0);
    }
    for (const row of confirmedDebits) {
      this.addCurrencyAmount(totalsByCurrency, row.currency, -(row._sum.amountMinor ?? 0));
    }
    const availableByCurrency = this.availableCurrencyTotals(totalsByCurrency);

    return {
      entries: available,
      totalMinor: availableByCurrency.USD ?? 0,
      currency: 'USD',
      count: totalEntries,
      page,
      limit,
      hasMore: entryRows.length > limit,
      totalsByCurrency: availableByCurrency,
    };
  }

  /** Allocate specific confirmed earnings to a payout request */
  private async allocatePayoutEarnings(
    tx: Prisma.TransactionClient,
    payoutRequestId: string,
    userId: string,
    amountMinor: number,
    currency: string,
    specificEntryIds?: string[],
  ) {
    let candidateEntries: EarningsLedger[];
    const unallocatedCreditWhere: Prisma.EarningsLedgerWhereInput = {
      userId,
      entryType: 'credit',
      status: 'confirmed',
      currency,
      payoutAllocations: {
        none: {
          payoutRequest: {
            userId,
            status: { in: RESERVED_PAYOUT_STATUSES },
          },
        },
      },
    };

    if (specificEntryIds && specificEntryIds.length > 0) {
      // Caller specified exact entries — validate they belong to user and are confirmed
      candidateEntries = await tx.earningsLedger.findMany({
        where: {
          ...unallocatedCreditWhere,
          id: { in: specificEntryIds },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Check for entries that were requested but are not eligible
      const foundIds = new Set(candidateEntries.map((e: { id: string }) => e.id));
      const invalidIds = specificEntryIds.filter((id) => !foundIds.has(id));
      if (invalidIds.length > 0) {
        throw new BadRequestException(
          `Earnings entries not eligible for payout: ${invalidIds.join(', ')}`,
        );
      }
    } else {
      // Auto-select oldest eligible entries in bounded pages. This avoids
      // loading a high-volume developer's entire ledger when a small payout
      // only needs the first few confirmed rows.
      candidateEntries = [];
      let selectedMinor = 0;
      let cursor: { id: string } | undefined;
      do {
        const page = await tx.earningsLedger.findMany({
          where: unallocatedCreditWhere,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          ...(cursor ? { cursor, skip: 1 } : {}),
          take: ALLOCATION_QUERY_PAGE_SIZE,
        });
        candidateEntries.push(...page);
        selectedMinor += page.reduce((sum, entry) => sum + entry.amountMinor, 0);
        cursor = page.length > 0 ? { id: page[page.length - 1].id } : undefined;
        if (page.length < ALLOCATION_QUERY_PAGE_SIZE) break;
      } while (selectedMinor < amountMinor);
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
  async requestPayout(
    userId: string,
    dto: {
      payoutAccountId: string;
      amountMinor: number;
      currency: string;
      earningsEntryIds?: string[];
    },
  ) {
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
      throw new ForbiddenException(
        'Two-factor authentication is required before requesting a payout',
      );
    }

    // Minimum threshold check — per-currency floor from the currency policy.
    const currency = dto.currency.trim().toUpperCase();
    const minPayout = payoutMinimumMinor(currency);
    if (dto.amountMinor < minPayout) {
      throw new BadRequestException(`Minimum payout is ${minPayout} ${currency} minor units`);
    }

    // ── Outer pre-checks (fast rejection) ──
    const [confirmedEarnings, confirmedDebits, allocatedTotal, openFlags, account] =
      await Promise.all([
        this.prisma.earningsLedger.aggregate({
          where: { userId, status: 'confirmed', entryType: 'credit', currency },
          _sum: { amountMinor: true },
        }),
        this.prisma.earningsLedger.aggregate({
          where: { userId, status: 'confirmed', entryType: 'debit', currency },
          _sum: { amountMinor: true },
        }),
        this.prisma.payoutAllocation.aggregate({
          where: {
            earningsEntry: { currency },
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
    // Payout destination verification is a money-movement safety gate: funds
    // must only leave to a destination an operator (or the provider) has
    // verified (ownership challenge, provider verification, etc.). An
    // unverified account can still be shown in the UI but cannot be used to
    // move money until verified.
    if (!account.isVerified) {
      throw new ForbiddenException(
        'Payout destination is not verified yet. Add a verified payout method or wait for admin verification.',
      );
    }
    // Destination-change cooldown (anti-account-takeover). A payout to a
    // destination that was just added or swapped must be protected by MFA.
    // Without this, a stolen session can repoint payouts to a fresh account
    // and drain earnings before the owner notices. Off unless an operator
    // sets PAYOUT_DESTINATION_COOLDOWN_HOURS.
    const cooldownHours = Number(
      this.config.get<string>('PAYOUT_DESTINATION_COOLDOWN_HOURS') ?? '0',
    );
    if (cooldownHours > 0) {
      const ageHours = (Date.now() - account.createdAt.getTime()) / 3_600_000;
      if (ageHours < cooldownHours && !user.twoFactorEnabled) {
        const waitHours = Math.ceil(cooldownHours - ageHours);
        throw new ForbiddenException(
          `Payouts to a recently changed destination require two-factor authentication. ` +
            `Enable 2FA or wait ~${waitHours}h.`,
        );
      }
    }
    // Currency safety: a payout can only move funds in the destination
    // account's currency. Without this, a USD-denominated earnings balance
    // could be paid to a EUR account (or vice versa), producing silently
    // mis-denominated payouts. Full multi-currency ledger accounting is a
    // follow-up; this guard blocks the cross-currency path today.
    if ((account.currency ?? 'USD').toUpperCase() !== currency) {
      throw new BadRequestException(
        `Payout currency ${currency} does not match the payout account currency ${account.currency}`,
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
          currency,
        },
      });

      await this.allocatePayoutEarnings(
        tx,
        payoutRequest.id,
        userId,
        dto.amountMinor,
        currency,
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
          currency,
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
        throw new BadRequestException(
          `Payout provider "${preflight.payoutAccount.provider}" not implemented`,
        );
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
            // Issue A-059: a partial approval must pay exactly the approved
            // amount and leave the unpaid remainder available. At request time
            // each allocation maps 1:1 to an earnings row of the same amount,
            // so shrink that earnings row to the paid slice and persist the
            // unpaid remainder as a fresh `confirmed` earnings row. Without
            // this split, markPayoutPaid would mark the WHOLE (larger) earnings
            // row `paid` and the developer would lose the remainder.
            const earningsEntry = await tx.earningsLedger.findUnique({
              where: { id: entry.earningsEntryId },
            });
            if (earningsEntry && earningsEntry.amountMinor > remaining) {
              const remainderMinor = earningsEntry.amountMinor - remaining;
              await tx.earningsLedger.update({
                where: { id: earningsEntry.id },
                data: { amountMinor: remaining },
              });
              await tx.earningsLedger.create({
                data: {
                  userId: earningsEntry.userId,
                  campaignId: earningsEntry.campaignId,
                  impressionId: earningsEntry.impressionId,
                  clickId: earningsEntry.clickId,
                  entryType: earningsEntry.entryType,
                  status: 'confirmed',
                  amountMinor: remainderMinor,
                  currency: earningsEntry.currency,
                  availableAt: earningsEntry.availableAt,
                  idempotencyKey: `payout_remainder_${payoutId}_${earningsEntry.id}`,
                  description: earningsEntry.description ?? 'Payout partial-approval remainder',
                },
              });
            }
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
      const holdEntryIds = allocations.map((a: { earningsEntryId: string }) => a.earningsEntryId);

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
      throw new BadRequestException(
        `Payout provider "${payout.payoutAccount.provider}" not implemented`,
      );
    }

    const expectedAmount = payout.approvedAmountMinor ?? payout.requestedAmountMinor;

    let result: { providerTxId: string; status: string };
    try {
      // Wrap the external PSP initiation in a timeout + circuit breaker (per
      // provider) so an unresponsive provider fails closed (markPayoutFailed)
      // instead of hanging the request thread indefinitely.
      result = await providerBreaker.call(`initiate:${payout.payoutAccount.provider}`, () =>
        withTimeout(
          () =>
            provider.initiate({
              payoutRequestId: payout.id,
              destination: payout.payoutAccount.destination,
              amountMinor: expectedAmount,
              currency: payout.currency,
            }),
          `provider initiate ${payout.payoutAccount.provider}`,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof PayoutProviderUnsafeFailure) {
        this.logger.error(`Unsafe payout provider failure for payout ${payout.id}: ${message}`);
        throw new BadRequestException(message);
      }

      await this.markPayoutFailed(payout.id, {
        provider: payout.payoutAccount.provider,
        providerTxId: `initiate_failed_${payout.id}`,
        failureReason: `Provider initiate threw before a safe provider transaction was recorded: ${message}`,
      });
      throw new BadRequestException(`Payout provider initiation failed: ${message}`);
    }

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
  async markPayoutPaid(
    payoutId: string,
    data: {
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
    },
  ) {
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

    return (
      paidPayout ??
      this.prisma.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      })
    );
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
  async markPayoutFailed(
    payoutId: string,
    data: {
      provider: string;
      providerTxId: string;
      failureReason: string;
    },
  ) {
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
