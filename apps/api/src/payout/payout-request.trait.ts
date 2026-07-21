import { BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EarningsLedger, Prisma } from '@waitlayer/db';
import { payoutMinimumMinor, payoutProviderLaunchStatus, PayoutStatus } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { isUniqueConstraintViolation } from '../common/utils/errors';
import { decryptPayoutDestination } from '../common/utils/payout-encryption';
import {
  CircuitBreakerOpenError,
  providerBreaker,
  withTimeout,
} from '../common/utils/provider-resilience';
import { PrismaService } from '../config/prisma.service';
import { ACTIVE_FRAUD_FLAG_STATUSES, payoutFraudLockKey } from '../fraud/fraud.constants';
import { AlertsService } from '../observability/alerts.service';
import { ReferralService } from '../referral/referral.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import {
  ALLOCATION_QUERY_PAGE_SIZE,
  PayoutProviderHandler,
  RESERVED_PAYOUT_STATUSES,
} from './payout.constants';
import { PayoutMethodTrait } from './payout-method.trait';
import { PayoutProviderUnsafeFailure } from './payout-provider.errors';
import { validatePayoutTransition } from './payout-state-machine';

const DEFAULT_PROVIDER_CALL_TIMEOUT_MS = 15_000;
function providerCallTimeoutMs(config: ConfigService): number {
  const configured = Number(
    config.get<number | string>('PROVIDER_CALL_TIMEOUT_MS') ?? DEFAULT_PROVIDER_CALL_TIMEOUT_MS,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PROVIDER_CALL_TIMEOUT_MS;
}

export class PayoutRequestTrait {
  declare prisma: PrismaService;
  declare referral: ReferralService;
  declare audit: AuditService;
  declare config: ConfigService;
  declare runtimeConfig: RuntimeConfigService;
  declare logger: Logger;
  declare providers: Record<string, PayoutProviderHandler>;
  declare alerts: AlertsService;

  addCurrencyAmount(
    totals: Record<string, bigint>,
    currency: string | null | undefined,
    amountMinor: bigint,
  ) {
    const key = (currency || 'USD').toUpperCase();
    totals[key] = (totals[key] ?? 0n) + amountMinor;
  }

  /**
   * Verify a replayed idempotency-key request carries the same payload as the
   * original. A replay with a different amount, currency, payout account, or
   * selected earnings entries is a client error (409 Conflict), not a silent
   * return of an unrelated earlier payout. Same-user is guaranteed by the
   * (userId, idempotencyKey) unique index, so it is not re-checked here.
   */
  private verifyIdempotentReplay(
    existing: Prisma.PayoutRequestGetPayload<{ include: { allocations: true } }>,
    dto: {
      payoutAccountId: string;
      amountMinor: bigint;
      currency: string;
      earningsEntryIds?: string[];
    },
    normalizedCurrency: string,
  ): void {
    if (existing.payoutAccountId !== dto.payoutAccountId) {
      throw new ConflictException(
        'Idempotency key was already used with a different payout account',
      );
    }
    if (existing.requestedAmountMinor !== dto.amountMinor) {
      throw new ConflictException('Idempotency key was already used with a different amount');
    }
    if (existing.currency.toUpperCase() !== normalizedCurrency) {
      throw new ConflictException('Idempotency key was already used with a different currency');
    }
    if (dto.earningsEntryIds && dto.earningsEntryIds.length > 0) {
      const existingEntryIds = new Set(
        existing.allocations.map((a: { earningsEntryId: string }) => a.earningsEntryId),
      );
      const sameEntries =
        dto.earningsEntryIds.length === existingEntryIds.size &&
        dto.earningsEntryIds.every((id) => existingEntryIds.has(id));
      if (!sameEntries) {
        throw new ConflictException(
          'Idempotency key was already used with different earnings entries',
        );
      }
    }
  }

  /** Allocate specific confirmed earnings to a payout request */
  async allocatePayoutEarnings(
    tx: Prisma.TransactionClient,
    payoutRequestId: string,
    userId: string,
    amountMinor: bigint,
    currency: string,
    specificEntryIds?: string[],
  ) {
    amountMinor = BigInt(amountMinor);
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
      let selectedMinor = 0n;
      let cursor:
        | {
            id: string;
          }
        | undefined;
      do {
        const page = await tx.earningsLedger.findMany({
          where: unallocatedCreditWhere,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          ...(cursor ? { cursor, skip: 1 } : {}),
          take: ALLOCATION_QUERY_PAGE_SIZE,
        });
        candidateEntries.push(...page);
        selectedMinor += page.reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n);
        cursor = page.length > 0 ? { id: page[page.length - 1].id } : undefined;
        if (page.length < ALLOCATION_QUERY_PAGE_SIZE) break;
      } while (selectedMinor < amountMinor);
    }
    // Walk through candidates, allocating entries until we reach the requested amount
    let remaining = amountMinor;
    const allocations: {
      earningsEntryId: string;
      amountMinor: bigint;
    }[] = [];
    for (const entry of candidateEntries) {
      if (remaining <= 0n) break;
      const allocAmount = entry.amountMinor < remaining ? entry.amountMinor : remaining;
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
    if (remaining > 0n) {
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
      amountMinor: bigint;
      currency: string;
      earningsEntryIds?: string[];
      idempotencyKey?: string;
    },
  ) {
    if (!(await this.runtimeConfig.isPayoutRequestsEnabled())) {
      throw new BadRequestException('Payout requests are temporarily disabled');
    }
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
    // Normalize currency early so the idempotency replay check can compare
    // apples-to-apples before any balance/account pre-checks.
    const currency = dto.currency.trim().toUpperCase();
    // ── Idempotency replay check (earliest possible, after auth) ──
    // A replayed request with the same user-scoped key must be detected before
    // balance/account/fraud pre-checks so that a mismatched payload always
    // returns 409, even if the original payout consumed the available balance
    // or the account state has changed. This intentionally skips the
    // `isCurrencyAllowed` and minimum-payout checks for replays: the key was
    // already used, so the original payout's currency/amount are the only valid
    // reference, regardless of current policy or balance. The (userId,
    // idempotencyKey) unique index is the authoritative floor; the in-tx
    // pre-check below handles the race where a concurrent request commits
    // between this read and the INSERT.
    const idempotencyKey = dto.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = await this.prisma.payoutRequest.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        include: { allocations: true },
      });
      if (existing) {
        this.verifyIdempotentReplay(existing, dto, currency);
        return existing;
      }
    }
    // Minimum threshold check — per-currency floor from the currency policy.
    if (!(await this.runtimeConfig.isCurrencyAllowed(currency))) {
      throw new BadRequestException(`Currency "${currency}" is currently blocked`);
    }
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
          where: {
            userId,
            status: { in: ACTIVE_FRAUD_FLAG_STATUSES },
            severity: { in: ['high', 'critical'] },
          },
        }),
        this.prisma.payoutAccount.findUnique({
          where: { id: dto.payoutAccountId },
        }),
      ]);
    const available =
      (confirmedEarnings._sum.amountMinor ?? 0n) -
      (confirmedDebits._sum.amountMinor ?? 0n) -
      (allocatedTotal._sum.amountMinor ?? 0n);
    if (dto.amountMinor > available) {
      throw new BadRequestException('Insufficient available earnings');
    }
    if (dto.amountMinor <= 0n) {
      throw new BadRequestException('Payout amount must be positive');
    }
    if (openFlags > 0) {
      throw new ForbiddenException('Payout blocked due to pending fraud review');
    }
    if (!account || account.userId !== userId) {
      throw new BadRequestException('Invalid payout account');
    }
    if (!account.isActive) {
      throw new ForbiddenException('Payout destination is inactive');
    }
    // Emergency freeze: an operator can freeze a destination (compromised
    // account, provider outage, sanctions-screening hit, etc.) without
    // deleting the account or toggling isActive. Frozen accounts are blocked
    // from payouts regardless of verification status.
    if (account.isFrozen) {
      throw new ForbiddenException('Payout destination is frozen by operator');
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
      const ageHours = (Date.now() - account.createdAt.getTime()) / 3600000;
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
    let committed: Prisma.PayoutRequestGetPayload<{ include: { allocations: true } }>;
    try {
      committed = await this.prisma.$transaction(async (tx) => {
        // In-tx pre-check (safe: SELECT before any failed statement). Handles
        // the race where a concurrent request committed after the outside
        // pre-check but before this tx opened.
        if (idempotencyKey) {
          const existing = await tx.payoutRequest.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey } },
            include: { allocations: true },
          });
          if (existing) {
            this.verifyIdempotentReplay(existing, dto, currency);
            return existing;
          }
        }

        // Re-check fraud state inside the authoritative allocation transaction.
        // An escalated flag is still under review and must remain payout-blocking;
        // escalation cannot become a way to bypass the outer pre-check. Share the
        // user's advisory lock with fraud creation so this predicate and creation
        // of the reserved payout cannot pass one another unobserved.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payoutFraudLockKey(userId)}))`;
        const activeFraudFlags = await tx.fraudFlag.count({
          where: {
            userId,
            status: { in: ACTIVE_FRAUD_FLAG_STATUSES },
            severity: { in: ['high', 'critical'] },
          },
        });
        if (activeFraudFlags > 0) {
          throw new ForbiddenException('Payout blocked due to pending fraud review');
        }

        // Create the payout request. If a concurrent request with the same
        // idempotency key committed between the pre-check and this INSERT, the
        // unique constraint throws P2002. We deliberately do NOT catch it here:
        // a statement-level constraint failure leaves the PostgreSQL
        // transaction aborted/unusable, so any further query on `tx` would fail
        // with "current transaction is aborted, commands ignored until end of
        // transaction block". Let the tx roll back and re-read the winner with
        // the normal Prisma client outside the $transaction call.
        const payoutRequest = await tx.payoutRequest.create({
          data: {
            userId,
            payoutAccountId: dto.payoutAccountId,
            status: 'requested',
            requestedAmountMinor: dto.amountMinor,
            currency,
            idempotencyKey,
          },
          include: { allocations: true },
        });
        await this.allocatePayoutEarnings(
          tx,
          payoutRequest.id,
          userId,
          dto.amountMinor,
          currency,
          dto.earningsEntryIds,
        );
        const finalRow = await tx.payoutRequest.findUnique({
          where: { id: payoutRequest.id },
          include: { allocations: true },
        });
        // The row was just created in this tx, so it is guaranteed to exist.
        if (!finalRow) {
          throw new Error(`Payout request ${payoutRequest.id} vanished mid-transaction`);
        }
        // Audit INSIDE the transaction so a rolled-back payout request never
        // leaves a success audit record, and a committed payout request is
        // guaranteed to have a matching audit row. This is a mandatory
        // financial event: audit failure fails the whole transaction.
        await this.audit.logStrict(
          {
            actorId: userId,
            actorRole: 'developer',
            action: 'request_payout',
            targetType: 'payout_request',
            targetId: finalRow.id,
            beforeSnap: {
              requestedAmountMinor: String(dto.amountMinor),
              currency,
              allocationCount: dto.earningsEntryIds?.length ?? 0,
            },
          },
          tx,
        );
        return finalRow;
      });
    } catch (err: unknown) {
      // The tx rolled back after a P2002 on (userId, idempotencyKey). The only
      // P2002 that can escape the $transaction is the idempotency-key one:
      // allocatePayoutEarnings catches the payout_allocations.earningsEntryId
      // P2002 and converts it to a BadRequestException. Re-read the winner with
      // the NORMAL client (the tx connection is closed) and verify the replayed
      // payload matches; a mismatched-payload reuse is a 409, not a silent
      // return of an unrelated earlier payout.
      if (idempotencyKey && isUniqueConstraintViolation(err)) {
        const winner = await this.prisma.payoutRequest.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          include: { allocations: true },
        });
        if (winner) {
          this.verifyIdempotentReplay(winner, dto, currency);
          return winner;
        }
      }
      throw err;
    }
    return committed!;
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
    const providerTimeoutMs = providerCallTimeoutMs(this.config);
    const preflight = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { payoutAccount: true },
    });
    if (!preflight) throw new BadRequestException('Payout request not found');
    const provider = this.providers[preflight.payoutAccount.provider];
    if (!provider) {
      throw new BadRequestException(
        `Payout provider "${preflight.payoutAccount.provider}" not implemented`,
      );
    }
    if (!(await this.runtimeConfig.isProviderEnabled(preflight.payoutAccount.provider))) {
      throw new BadRequestException(
        `Payout provider "${preflight.payoutAccount.provider}" is currently disabled`,
      );
    }
    const readiness = provider.readiness?.();
    if (readiness && !readiness.ok) {
      throw new BadRequestException(readiness.reason);
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
        include: {
          user: { select: { status: true } },
          payoutAccount: true,
          // explicit `orderBy` so the trim loop below trims a
          // deterministic allocation slice across retries / Postgres versions.
          // Prisma relation includes default to no implicit ordering, which
          // made "oldest-first to keep the most recently allocated slice"
          // implementation-defined and could trim a different slice on a
          // markPayoutFailed → re-process cycle.
          allocations: { orderBy: { createdAt: 'asc' }, include: { earningsEntry: true } },
        },
      });
      if (!pkt) throw new BadRequestException('Payout request not found');
      if (pkt.user.status !== 'active') {
        throw new ForbiddenException('Payout user is no longer active');
      }
      if (!pkt.payoutAccount.isActive || !pkt.payoutAccount.isVerified) {
        throw new ForbiddenException('Payout destination is no longer active and verified');
      }
      // This is the authoritative destination check: a freeze may land after
      // request/approval, so processPayout must re-check inside the same
      // transaction that claims approved -> processing. Throwing here rolls
      // the claim back and prevents creation of the provider placeholder.
      if (pkt.payoutAccount.isFrozen) {
        throw new ForbiddenException('Payout destination is frozen by operator');
      }
      // This lock and the durable processing claim/account fence commit as one
      // authorization point. A flag that commits first is observed below; a
      // flag that starts later waits until the initiation intent is durable.
      // The external provider call deliberately happens after this transaction
      // commits, so fraud creation never waits on provider latency.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payoutFraudLockKey(pkt.userId)}))`;
      const activeFraudFlags = await tx.fraudFlag.count({
        where: {
          userId: pkt.userId,
          status: { in: ACTIVE_FRAUD_FLAG_STATUSES },
          severity: { in: ['high', 'critical'] },
        },
      });
      if (activeFraudFlags > 0) {
        throw new ForbiddenException('Payout blocked due to pending fraud review');
      }
      const launchOverrides = this.config.get<string>('WAITLAYER_PAYOUT_PROVIDER_STATUS');
      if (
        payoutProviderLaunchStatus(pkt.payoutAccount.provider, launchOverrides) === 'coming_soon'
      ) {
        throw new BadRequestException(
          `Payout provider "${pkt.payoutAccount.provider}" is currently gated`,
        );
      }
      const expectedAmount = BigInt(pkt.approvedAmountMinor ?? pkt.requestedAmountMinor);
      // ── Allocation-sum reconciliation ──────────────────────────
      // A partial approval (admin set approvedAmountMinor < requestedAmountMinor)
      // means the existing allocations overshoot the approved amount — we
      // must trim them here or the recon fails and leaves the payout stuck
      // in `processing` (formerly the entire recon ran OUTSIDE the tx, so
      // the flip was already committed).
      let allocations = [...pkt.allocations];
      let allocatedSum = allocations.reduce(
        (
          sum: bigint,
          a: {
            amountMinor: bigint;
          },
        ) => sum + BigInt(a.amountMinor),
        0n,
      );
      if (allocatedSum > expectedAmount) {
        // Trim the over-allocated slice. We delete the excess allocation
        // rows (oldest-first to keep the most recently allocated slice)
        // so the remaining sum matches `expectedAmount`.
        let overage = allocatedSum - expectedAmount;
        const removedIds = new Set<string>();
        for (let i = 0; i < allocations.length && overage > 0n; i++) {
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
              // CAS-pin the earnings retire to `status: 'confirmed'`
              // so a concurrent `holdEarnings` (fraud service) can't be silently
              // overwritten. If this row was concurrently held, the count===0 path
              // throws a clear 400 instead of silently retiring a held row
              // (which would flip it to 'reversed' and orphan the hold — a latent
              // money leak). Adversarially reviewed.
              const retire = await tx.earningsLedger.updateMany({
                where: { id: earningsEntry.id, status: 'confirmed' },
                data: {
                  status: 'reversed',
                  description: `Superseded by partial payout approval ${payoutId}`,
                },
              });
              if (retire.count === 0) {
                throw new BadRequestException(
                  `Earnings entry ${earningsEntry.id} was concurrently modified — cannot split`,
                );
              }
              const paidSlice = await tx.earningsLedger.create({
                data: {
                  userId: earningsEntry.userId,
                  campaignId: earningsEntry.campaignId,
                  impressionId: earningsEntry.impressionId,
                  clickId: earningsEntry.clickId,
                  entryType: earningsEntry.entryType,
                  status: 'confirmed',
                  amountMinor: remaining,
                  currency: earningsEntry.currency,
                  availableAt: earningsEntry.availableAt,
                  idempotencyKey: `payout_slice_${payoutId}_${earningsEntry.id}`,
                  description: earningsEntry.description ?? 'Payout partial-approval slice',
                },
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
              await tx.payoutAllocation.update({
                where: { id: entry.id },
                data: { amountMinor: remaining, earningsEntryId: paidSlice.id },
              });
              entry.earningsEntryId = paidSlice.id;
              entry.amountMinor = remaining;
            } else {
              throw new BadRequestException(
                `Allocated earnings entry ${entry.earningsEntryId} is missing or smaller than its partial approval slice`,
              );
            }
            allocatedSum -= overage;
            overage = 0n;
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
      // Atomically serialize provider initiation against the operator freeze.
      // The payout id is a durable fence, not an expiring lease: if this worker
      // crashes after the claim commits, neither another payout nor a freeze can
      // overtake an initiation whose remote outcome may be unknown. Marking this
      // payout paid/failed (or the normal finally block) clears the fence after
      // reconciliation.
      const fence = await tx.payoutAccount.updateMany({
        where: {
          id: pkt.payoutAccount.id,
          isFrozen: false,
          isActive: true,
          isVerified: true,
          initiationPayoutId: null,
        },
        data: {
          initiationPayoutId: payoutId,
        },
      });
      if (fence.count === 0) {
        const accountState = await tx.payoutAccount.findUnique({
          where: { id: pkt.payoutAccount.id },
          select: {
            isFrozen: true,
            isActive: true,
            isVerified: true,
            initiationPayoutId: true,
          },
        });
        if (accountState?.isFrozen) {
          throw new ForbiddenException('Payout destination is frozen by operator');
        }
        if (accountState && (!accountState.isActive || !accountState.isVerified)) {
          throw new ForbiddenException('Payout destination is no longer active and verified');
        }
        throw new ConflictException(
          'Another payout initiation is active for this destination; retry after it completes',
        );
      }
      const placeholder = await tx.payoutTransaction.create({
        data: {
          payoutRequestId: pkt.id,
          provider: pkt.payoutAccount.provider,
          providerTxId: `initiate_pending_${pkt.id}`,
          status: PayoutStatus.PROCESSING,
        },
      });
      return {
        ...pkt,
        placeholderTransactionId: placeholder.id,
      };
    });
    let retainFenceForReconciliation = false;
    try {
      const expectedAmount = payout.approvedAmountMinor ?? payout.requestedAmountMinor;
      let result: { providerTxId: string; status: string };
      try {
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
            providerTimeoutMs,
          ),
        );
        const recorded = await this.prisma.$transaction(async (tx) => {
          const providerTxUpdate = await tx.payoutTransaction.updateMany({
            where: {
              id: payout.placeholderTransactionId,
              providerTxId: `initiate_pending_${payout.id}`,
              status: PayoutStatus.PROCESSING,
            },
            data: { providerTxId: result.providerTxId, failureReason: null },
          });
          if (providerTxUpdate.count !== 1) {
            throw new Error(
              `Could not bind provider transaction ${result.providerTxId} to payout ${payout.id}`,
            );
          }
          if (payout.payoutAccount.provider === 'stripe_connect') {
            await tx.platformLedger.upsert({
              where: { idempotencyKey: `developer_payout_cash_${payout.id}` },
              create: {
                entryType: 'reversal',
                status: 'confirmed',
                amountMinor: expectedAmount,
                currency: payout.currency,
                bucket: 'cash',
                referenceId: payout.id,
                idempotencyKey: `developer_payout_cash_${payout.id}`,
                description: `Developer payout cash initiated - payout ${payout.id}`,
              },
              update: {},
            });
          }
          return providerTxUpdate;
        });
        if (recorded.count !== 1) {
          throw new Error(
            `Provider payout ${result.providerTxId} was not recorded for payout ${payout.id}`,
          );
        }
      } catch (err: unknown) {
        if (err instanceof CircuitBreakerOpenError) {
          // The breaker rejected before invoking the provider callback, so the
          // remote outcome is known: no transfer was attempted. Close the local
          // claim as failed and release allocations/fence instead of creating a
          // permanent ambiguous-initiation incident.
          await this.markPayoutFailed(payout.id, {
            provider: payout.payoutAccount.provider,
            providerTxId: `initiate_pending_${payout.id}`,
            failureReason: err.message,
          });
          throw new BadRequestException(err.message);
        }
        retainFenceForReconciliation = true;
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.payoutTransaction.updateMany({
          where: { id: payout.placeholderTransactionId, status: PayoutStatus.PROCESSING },
          data: {
            failureReason:
              'Provider initiation threw or timed out; remote outcome requires reconciliation before allocations can be released',
          },
        });
        this.logger.error(`Ambiguous provider initiation for payout ${payout.id}: ${message}`);
        throw new BadRequestException(
          err instanceof PayoutProviderUnsafeFailure
            ? err.message
            : 'Payout provider outcome is unknown; allocations remain reserved for reconciliation',
        );
      }
      if (result.status === PayoutStatus.FAILED) {
        try {
          await this.markPayoutFailed(payout.id, {
            provider: payout.payoutAccount.provider,
            providerTxId: result.providerTxId,
            failureReason: 'Provider initiate returned failed',
          });
        } catch (err) {
          retainFenceForReconciliation = true;
          throw err;
        }
        return { payoutId, providerTxId: result.providerTxId, status: PayoutStatus.FAILED };
      }
      if (result.status === PayoutStatus.PAID) {
        try {
          await this.markPayoutPaid(payout.id, {
            providerTxId: result.providerTxId,
            paidAt: new Date().toISOString(),
          });
        } catch (err) {
          retainFenceForReconciliation = true;
          throw err;
        }
        return { payoutId, providerTxId: result.providerTxId, status: PayoutStatus.PAID };
      }
      return { payoutId, providerTxId: result.providerTxId, status: 'processing' };
    } finally {
      // Release only this payout's durable initiation fence. A transient DB
      // failure deliberately leaves it in place for explicit reconciliation;
      // silently expiring an ambiguous money-movement claim is unsafe.
      if (!retainFenceForReconciliation) {
        try {
          await this.prisma.payoutAccount.updateMany({
            where: {
              id: payout.payoutAccount.id,
              initiationPayoutId: payout.id,
            },
            data: {
              initiationPayoutId: null,
            },
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to release payout initiation fence for account ${payout.payoutAccount.id}: ${message}`,
          );
        }
      }
    }
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
      providerTxId?: string;
      paidAt: string;
      // Optional cross-check fields supplied by the admin body (MarkPayoutPaidDto).
      // When present, the stored approved/requested amountMinor AND currency MUST
      // match — this catches a transposed digit / wrong-currency mark-paid before
      // the payout is irreversibly flipped. When absent (e.g. path callers that
      // only have providerTxId + paidAt), the cross-check is skipped, preserving
      // the prior behavior so webhook/automated callers don't break.
      expectedAmountMinor?: bigint;
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
    const authoritativeAmount = payout.approvedAmountMinor ?? payout.requestedAmountMinor;
    // Idempotency fast-path: replay the idempotent money side-effects too. A
    // prior call may have committed the paid state before referral processing
    // failed, and legacy paid payouts may predate cash-ledger accounting.
    if (payout.status === 'paid') {
      await this.prisma.payoutAccount.updateMany({
        where: { initiationPayoutId: payoutId },
        data: { initiationPayoutId: null },
      });
      await this.prisma.platformLedger.upsert({
        where: { idempotencyKey: `developer_payout_cash_${payoutId}` },
        create: {
          entryType: 'reversal',
          status: 'confirmed',
          amountMinor: authoritativeAmount,
          currency: payout.currency,
          bucket: 'cash',
          referenceId: payoutId,
          idempotencyKey: `developer_payout_cash_${payoutId}`,
          description: `Developer payout cash settled — payout ${payoutId}`,
        },
        update: {},
      });
      await this.referral.processReferralRewards(payout.userId);
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
    // Collect every allocated earnings entry. A `processing` payout crossed
    // processPayout's fraud lock + confirmed-entry check before provider I/O,
    // so a later critical flag may hold those rows but cannot revoke an already
    // initiated transfer. An `approved` payout has not crossed that boundary
    // and therefore remains limited to confirmed rows.
    const earningsIds = payout.allocations.map(
      (a: { earningsEntryId: string }) => a.earningsEntryId,
    );
    const payableEarningsStatuses =
      payout.status === 'processing' ? (['confirmed', 'held'] as const) : (['confirmed'] as const);
    // Single atomic transaction with an authoritative TOCTOU guard.
    // The payout-row conditional `update where status in ('approved','processing')`
    // ensures that at most one caller flips the state from a legal pre-state;
    // the loser (count === 0) re-reads to decide idempotent-return vs. throw.
    // Declarative state-machine guard: reject any PayoutRequest transition not
    // enumerated in PAYOUT_TRANSITIONS. The atomic CAS
    // `updateMany where status in ('approved','processing')` below stays the
    // authoritative concurrency check — this is the human-readable gate layered
    // in front of it.
    // Anomaly detection (P1.25): a payout marked paid without a provider
    // transaction id is unusual. The reconciliation cron legitimately reaches
    // this path via checkStatusByReference for completed payouts, and a
    // manual/webhook mark-paid without a providerTxId is exactly the anomaly
    // we want to surface. Fire BEFORE flipping the status so the event is
    // captured. Wrapped so alerting can never block the payout transition.
    if (!data.providerTxId) {
      try {
        this.alerts.alertPayoutPaidWithoutProviderTx({
          payoutId,
          provider: payout.payoutAccount.provider,
          currency: payout.currency,
          amountMinor: payout.approvedAmountMinor ?? payout.requestedAmountMinor,
        });
      } catch {
        // alerting must never block the payout transition
      }
    }
    validatePayoutTransition(payout.status as PayoutStatus, PayoutStatus.PAID);
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
          await tx.payoutAccount.updateMany({
            where: { initiationPayoutId: payoutId },
            data: { initiationPayoutId: null },
          });
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
      // 3. Retire the allocated earnings. For already-processing payouts, a
      // post-authorization fraud hold is settled as paid and its flag stamp is
      // cleared so a later flag release cannot resurrect withdrawable funds.
      // Approved payouts still require confirmed entries only.
      if (earningsIds.length > 0) {
        await tx.earningsLedger.updateMany({
          where: { id: { in: earningsIds }, status: { in: [...payableEarningsStatuses] } },
          data: { status: 'paid', heldByFlagId: null },
        });
        // Authoritative post-check: any row outside the statuses authorized
        // above (for example reversed, or held before an approved payout) keeps
        // the whole terminal transition from committing.
        const paidCount = await tx.earningsLedger.aggregate({
          where: { id: { in: earningsIds }, status: 'paid' },
          _count: { _all: true },
        });
        if (paidCount._count._all !== earningsIds.length) {
          // Throw inside the transaction → rolls back the payoutRequest → paid
          // flip AND the payoutTransaction row. The payout stays in its prior
          // state ('approved'/'processing') so the operation can be retried.
          throw new BadRequestException(
            `Payout ${payoutId} cannot be marked paid: ${earningsIds.length - paidCount._count._all} allocated earnings entry/entries are no longer in an authorized payable status`,
          );
        }
      }
      await tx.platformLedger.upsert({
        where: { idempotencyKey: `developer_payout_cash_${payoutId}` },
        create: {
          entryType: 'reversal',
          status: 'confirmed',
          amountMinor: authoritativeAmount,
          currency: payout.currency,
          bucket: 'cash',
          referenceId: payoutId,
          idempotencyKey: `developer_payout_cash_${payoutId}`,
          description: `Developer payout cash settled — payout ${payoutId}`,
        },
        update: {},
      });
      await tx.payoutAccount.updateMany({
        where: { initiationPayoutId: payoutId },
        data: { initiationPayoutId: null },
      });
      return tx.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    });
    // Await the idempotent referral reward. If it fails, callers receive an
    // error and may replay mark-paid; the payout cron also reclaims pending
    // referrals independently.
    const paidPayout = result;
    if (paidPayout?.status === 'paid') {
      await this.referral.processReferralRewards(paidPayout.userId);
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
      providerTxId?: string;
      failureReason: string;
    },
  ) {
    // Declarative state-machine guard: reject any PayoutRequest transition not
    // enumerated in PAYOUT_TRANSITIONS. The atomic CAS
    // `updateMany where status in ('approved','processing')` below stays the
    // authoritative concurrency check. We load the current row only to read its
    // status for the guard; a `failed` payout is skipped so a re-delivered
    // failure stays idempotent (no-op return, not a throw), and a missing row
    // defers to the existing CAS/re-read not-found path.
    const payout = await this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    if (payout && payout.status !== PayoutStatus.FAILED) {
      validatePayoutTransition(payout.status as PayoutStatus, PayoutStatus.FAILED);
    }
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
        if (current?.status === PayoutStatus.FAILED) {
          await tx.payoutAccount.updateMany({
            where: { initiationPayoutId: payoutId },
            data: { initiationPayoutId: null },
          });
          return current;
        }
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
      await tx.payoutAccount.updateMany({
        where: { initiationPayoutId: payoutId },
        data: { initiationPayoutId: null },
      });
      return tx.payoutRequest.findUnique({
        where: { id: payoutId },
        include: { allocations: true },
      });
    });
  }
}
export interface PayoutRequestTrait extends PayoutMethodTrait {}
