import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { PayoutService } from '../payout/payout.service';
import {
  FencedAccountListResponseDto,
  ReleasePayoutFenceOptions,
  ReleasePayoutFenceResponseDto,
} from './dto/admin.dto';
export type { ReleasePayoutFenceOptions };
/** Minimal shape of the reconciliation columns we surface on fenced views. */
interface ReconciliationTelemetry {
  id: string;
  reconciliationAttempts: number;
  lastReconciliationAt: Date | null;
  escalatedAt: Date | null;
}

export class AdminPayoutsTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare emailQueueService: EmailQueueService;
  declare payoutService: PayoutService;

  async getPendingPayouts() {
    return this.prisma.payoutRequest.findMany({
      where: { status: { in: ['requested', 'under_review', 'approved', 'processing'] } },
      include: {
        user: { select: { email: true, name: true, trustLevel: true } },
        payoutAccount: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approvePayout(
    payoutId: string,
    reviewerId: string,
    note?: string,
    approvedAmountMinor?: bigint,
  ) {
    // Conditional update: only approve from a reviewable state. This prevents
    // an admin (or a compromised admin token) from re-approving a payout that
    // is already `paid`/`processing` (destroying the payment audit trail) or
    // resurrecting a `rejected`/`cancelled`/`failed` payout. `count === 0`
    // means the payout is missing or not in a reviewable state — surface that
    // rather than silently no-op.
    //
    // Amount reconciliation: always set `approvedAmountMinor` authorita-
    // tively. Previously the column was never written, so the reconciliation
    // guards in `processPayout` and `markPayoutPaid` (which prefer
    // `approvedAmountMinor ?? requestedAmountMinor`) silently fell back to
    // the requested amount — a deliberately-reduced approval would still be
    // paid at the higher requested figure. Now:
    //   - partial approval: `approvedAmountMinor` (validated `> 0` and
    //     `<= requestedAmountMinor`) — the payout is authorised at the
    //     reduced figure.
    //   - full approval (omitted): `approvedAmountMinor = requestedAmountMinor`
    //     — explicit, so the reconciliation prefers the APPROVED value
    //     rather than the requested one going forward.
    if (approvedAmountMinor !== undefined) {
      if (approvedAmountMinor <= 0n) {
        throw new BadRequestException('approvedAmountMinor must be a positive integer');
      }
    }
    // Read BEFORE the conditional update to validate a partial-approval amount
    // AND resolve the full-approval amount (requestedAmountMinor). The
    // conditional update below is the authoritative state guard; this read is
    // just the bounds/data check — a TOCTOU between this read and the update
    // cannot inflate the approved amount because requestedAmountMinor is
    // immutable post-request (see PayoutRequest schema).
    const target = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      select: { requestedAmountMinor: true, currency: true },
    });
    if (!target) throw new BadRequestException('Payout not found');
    let resolvedApprovedAmount: bigint;
    if (approvedAmountMinor !== undefined) {
      // Partial approval — validated against requested
      if (approvedAmountMinor > target.requestedAmountMinor) {
        throw new BadRequestException(
          `approvedAmountMinor (${approvedAmountMinor}) cannot exceed requestedAmountMinor (${target.requestedAmountMinor})`,
        );
      }
      resolvedApprovedAmount = approvedAmountMinor;
    } else {
      // Full approval — use the requested amount. We read it now and write
      // it in the single updateMany below so approvedAmountMinor is
      // authoritative from the moment the row flips, rather than null
      // briefly between two writes.
      resolvedApprovedAmount = target.requestedAmountMinor;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.updateMany({
        where: { id: payoutId, status: { in: ['requested', 'under_review'] } },
        data: {
          status: 'approved',
          reviewerId,
          reviewNote: note,
          processedAt: new Date(),
          approvedAmountMinor: resolvedApprovedAmount,
        },
      });
      if (result.count === 0) {
        const existing = await tx.payoutRequest.findUnique({
          where: { id: payoutId },
          select: { status: true },
        });
        throw new BadRequestException(
          existing
            ? `Payout cannot be approved from status '${existing.status}'`
            : 'Payout not found',
        );
      }
      const row = await tx.payoutRequest.findUnique({ where: { id: payoutId } });
      // Audit: admin payout approval — financial admin operation involving real
      // money movement. Forensic trail must identify the approving admin and
      // the authorised amount. Written inside the transaction so a rolled-back
      // approval never leaves an success audit record.
      await this.audit.logStrict(
        {
          actorId: reviewerId,
          actorRole: 'admin',
          action: 'approve_payout',
          targetType: 'payout_request',
          targetId: payoutId,
          beforeSnap: {
            approvedAmountMinor: resolvedApprovedAmount.toString(),
            note,
            partial: approvedAmountMinor !== undefined,
          },
        },
        tx,
      );
      return row;
    });

    return updated;
  }

  async rejectPayout(payoutId: string, reviewerId: string, reason: string) {
    // Only reject from a pre-payment state. Rejecting an already-`paid` payout
    // would contradict the ledger (earnings are already `paid`); rejecting a
    // `processing` payout risks a stuck provider call with no DB record.
    //
    // **Allocation cleanup**: PayoutAllocation rows have a `@@unique([earningsEntryId])`
    // floor that prevents concurrent double-allocation between racing
    // `requestPayout` calls. Stale allocations from a now-rejected request
    // would prevent the developer from re-requesting against those same
    // earnings (they'd hit the unique-key error in `requestPayout`). Delete
    // the rejected request's allocations in the SAME transaction so the
    // earnings entries become re-available for a fresh payout attempt.
    const updated = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.payoutRequest.updateMany({
        where: { id: payoutId, status: { in: ['requested', 'under_review', 'approved'] } },
        data: { status: 'rejected', reviewerId, reviewNote: reason },
      });
      if (flip.count === 0) {
        const existing = await tx.payoutRequest.findUnique({
          where: { id: payoutId },
          select: { status: true },
        });
        throw new BadRequestException(
          existing
            ? `Payout cannot be rejected from status '${existing.status}'`
            : 'Payout not found',
        );
      }
      await tx.payoutAllocation.deleteMany({
        where: { payoutRequestId: payoutId },
      });
      const row = await tx.payoutRequest.findUnique({ where: { id: payoutId } });
      // Audit: admin payout rejection — releases held earnings. Forensic trail
      // must identify the rejecting admin and the rejection reason. Written
      // inside the transaction so a rolled-back rejection never leaves an
      // audit record.
      await this.audit.logStrict(
        {
          actorId: reviewerId,
          actorRole: 'admin',
          action: 'reject_payout',
          targetType: 'payout_request',
          targetId: payoutId,
          beforeSnap: { reason },
        },
        tx,
      );
      return row;
    });

    return updated;
  }

  async processPayout(payoutId: string) {
    return this.payoutService.processPayout(payoutId);
  }

  async markPayoutPaid(
    payoutId: string,
    data: {
      providerTxId: string;
      paidAt: string;
      amountMinor: bigint;
      currency: string;
    },
  ) {
    // The DTO carries amountMinor + currency so the admin's body can be
    // cross-checked against the payout's stored values before flipping it to
    // `paid`. Previously these fields were dropped silently — a transposed
    // digit in the admin's body would still mark the (wrong) payout as paid.
    // We surface the cross-check inside the payout service so the flip is
    // atomic with the validation (re-read inside the tx).
    return this.payoutService.markPayoutPaid(payoutId, {
      providerTxId: data.providerTxId,
      paidAt: data.paidAt,
      expectedAmountMinor: data.amountMinor,
      expectedCurrency: data.currency,
    });
  }

  // ── Payout account verification ──
  /**
   * Verify or reject a developer's payout destination before it can be used to
   * move money. Payout requests to unverified accounts are rejected by
   * PayoutService, so this is the operator-side gate that unlocks them. Both
   * actions are audited and scoped to admin/support roles upstream.
   */
  async setPayoutAccountVerified(
    reviewerId: string,
    reviewerRole: string,
    payoutAccountId: string,
    verified: boolean,
    reason?: string,
  ) {
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!account) throw new NotFoundException('Payout account not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payoutAccount.update({
        where: { id: payoutAccountId },
        data: { isVerified: verified },
      });
      await this.audit.logStrict(
        {
          actorId: reviewerId,
          actorRole: reviewerRole,
          action: verified ? 'payout_account_verified' : 'payout_account_rejected',
          targetType: 'payout_account',
          targetId: payoutAccountId,
          beforeSnap: { isVerified: account.isVerified },
          afterSnap: {
            isVerified: verified,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
            reason: reason ?? null,
          },
        },
        tx,
      );
      return row;
    });
    return updated;
  }

  /**
   * Emergency-freeze a payout destination. Frozen accounts remain verified and
   * active but cannot be used for payouts until an admin explicitly unfreezes
   * them. This is the operator-level kill switch for a single destination.
   */
  async freezePayoutAccount(
    reviewerId: string,
    reviewerRole: string,
    payoutAccountId: string,
    reason?: string,
  ) {
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!account) throw new NotFoundException('Payout account not found');
    // Idempotency guard: reject re-freeze with 409 Conflict. The admin UI is
    // double-clickable; surfacing the duplicate state is better than a silent
    // no-op (which leaves operators unsure if the action took effect) and
    // matches the strict state-machine guards in approvePayout/rejectPayout.
    if (account.isFrozen) throw new ConflictException('Payout account is already frozen');
    // Race the provider-initiation path with one conditional update on the same
    // account row. A durable payout-id fence represents an initiation that must
    // be reconciled before the destination can be frozen; it never expires
    // underneath a paused worker.
    const updated = await this.prisma.$transaction(async (tx) => {
      const freeze = await tx.payoutAccount.updateMany({
        where: {
          id: payoutAccountId,
          isFrozen: false,
          initiationPayoutId: null,
        },
        data: {
          isFrozen: true,
        },
      });
      if (freeze.count === 0) {
        const current = await tx.payoutAccount.findUnique({
          where: { id: payoutAccountId },
          select: {
            isFrozen: true,
            initiationPayoutId: true,
          },
        });
        if (!current) throw new NotFoundException('Payout account not found');
        if (current.isFrozen) {
          throw new ConflictException('Payout account is already frozen');
        }
        if (current.initiationPayoutId) {
          throw new ConflictException(
            `Payout ${current.initiationPayoutId} has an active or ambiguous provider initiation; reconcile it before freezing this destination`,
          );
        }
        throw new ConflictException('Payout account changed concurrently; retry the freeze');
      }
      const row = await tx.payoutAccount.findUnique({
        where: { id: payoutAccountId },
      });
      if (!row) throw new NotFoundException('Payout account not found');
      await this.audit.logStrict(
        {
          actorId: reviewerId,
          actorRole: reviewerRole,
          action: 'payout_account_frozen',
          targetType: 'payout_account',
          targetId: payoutAccountId,
          beforeSnap: {
            isFrozen: account.isFrozen,
            isVerified: account.isVerified,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
          },
          afterSnap: {
            isFrozen: true,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
            reason: reason ?? null,
          },
        },
        tx,
      );
      return row;
    });
    // Best-effort developer notification. The audit row is the canonical
    // forensic trail; the email is an out-of-band UX hint so the developer
    // isn't surprised when their next payout silently 403s. Failures here
    // must never block freezing — a Resend outage should not freeze an
    // account unconfirmed — so we fire-and-forget with .catch.
    if (account.user?.email) {
      void this.emailQueueService
        .sendPayoutAccountFrozenAlert(account.user.email, {
          provider: account.provider,
          destination: account.destination ?? undefined,
          currency: account.currency ?? 'USD',
          actorRole: reviewerRole,
          reason: reason ?? undefined,
          time: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[AdminPayoutsTrait] payout-account-frozen email delivery failed: ${msg}`);
        });
    }
    return updated;
  }

  /**
   * List payout accounts that currently hold a durable provider-initiation
   * fence (`initiationPayoutId` is not null). These accounts are blocked
   * from new payouts and from being frozen until the fence is cleared.
   * Operators use this for operational monitoring and reconciliation.
   */
  async getFencedAccounts(params?: {
    page?: number;
    limit?: number;
  }): Promise<FencedAccountListResponseDto> {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.payoutAccount.findMany({
        where: { initiationPayoutId: { not: null } },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payoutAccount.count({
        where: { initiationPayoutId: { not: null } },
      }),
    ]);

    // Batch-load reconciliation telemetry for each fenced account's in-flight
    // (initiation) payout. Fenced accounts always carry an initiationPayoutId
    // by definition, so the associated PayoutRequest is the authoritative
    // source for reconciliationAttempts / lastReconciliationAt / escalatedAt.
    const initiationIds = items
      .map((a) => a.initiationPayoutId)
      .filter((id): id is string => Boolean(id));
    const reconciliationById = new Map<string, ReconciliationTelemetry>();
    if (initiationIds.length > 0) {
      const payouts = await this.prisma.payoutRequest.findMany({
        where: { id: { in: initiationIds } },
        select: {
          id: true,
          reconciliationAttempts: true,
          lastReconciliationAt: true,
          escalatedAt: true,
        },
      });
      for (const payout of payouts) {
        reconciliationById.set(payout.id, payout);
      }
    }

    const enriched = items.map((account) => {
      const telemetry = account.initiationPayoutId
        ? reconciliationById.get(account.initiationPayoutId)
        : undefined;
      return {
        ...account,
        reconciliationAttempts: telemetry?.reconciliationAttempts ?? 0,
        lastReconciliationAt: telemetry?.lastReconciliationAt?.toISOString() ?? null,
        escalatedAt: telemetry?.escalatedAt?.toISOString() ?? null,
      };
    });

    return { items: enriched, total, page, limit };
  }

  /**
   * Explicitly release a payout account's durable initiation fence. This is an
   * operator escape hatch for the rare case where the automatic fence-clearing
   * in `markPayoutPaid`/`markPayoutFailed` could not run (e.g. a transient DB
   * failure or a crashed worker). It must only be used after the operator has
   * confirmed the provider outcome for the referenced payout.
   */
  async releasePayoutFence(
    options: ReleasePayoutFenceOptions,
  ): Promise<ReleasePayoutFenceResponseDto> {
    const { payoutAccountId, reviewerId, reviewerRole, reason, providerTxId, resolution } = options;
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!account) throw new NotFoundException('Payout account not found');
    if (!account.initiationPayoutId) {
      throw new BadRequestException('Payout account does not have an active initiation fence');
    }
    // Narrow the nullable column now that we have verified it is set. The
    // value is captured in a local const so TypeScript treats it as a
    // non-null string inside the transaction (and so the Prisma `where`
    // clause receives `string` rather than `string | null`).
    const initiationPayoutId = account.initiationPayoutId;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Safety guard (inside the tx to avoid a status race): the fence
      // references a payout whose provider outcome must be known before the
      // account can be unblocked. Only terminal/reconcilable states are
      // allowed; a non-terminal payout may still be in flight and releasing
      // its fence could allow a second concurrent initiation.
      const fencedPayout = await tx.payoutRequest.findUnique({
        where: { id: initiationPayoutId },
        select: {
          status: true,
          reconciliationAttempts: true,
          lastReconciliationAt: true,
          escalatedAt: true,
        },
      });
      if (!fencedPayout) {
        throw new BadRequestException(
          `Referenced payout ${account.initiationPayoutId} no longer exists; use the normal freeze/unfreeze flow`,
        );
      }
      const allowedStatuses = new Set(['paid', 'failed', 'rejected', 'cancelled']);
      if (!allowedStatuses.has(fencedPayout.status)) {
        throw new BadRequestException(
          `Payout ${account.initiationPayoutId} is in status '${fencedPayout.status}'; confirm the provider outcome before releasing the fence`,
        );
      }
      const row = await tx.payoutAccount.update({
        where: { id: payoutAccountId },
        data: { initiationPayoutId: null },
      });
      await this.audit.logStrict(
        {
          actorId: reviewerId,
          actorRole: reviewerRole,
          action: 'release_payout_fence',
          targetType: 'payout_account',
          targetId: payoutAccountId,
          beforeSnap: {
            initiationPayoutId: account.initiationPayoutId,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
            reason: reason ?? null,
          },
          afterSnap: {
            initiationPayoutId: null,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
            reason: reason ?? null,
            observedPayoutStatus: fencedPayout.status,
            providerTxId: providerTxId ?? null,
            resolution: resolution ?? null,
          },
        },
        tx,
      );
      return {
        row,
        telemetry: {
          reconciliationAttempts: fencedPayout.reconciliationAttempts ?? 0,
          lastReconciliationAt: fencedPayout.lastReconciliationAt?.toISOString() ?? null,
          escalatedAt: fencedPayout.escalatedAt?.toISOString() ?? null,
        },
      };
    });
    return {
      ...updated.row,
      ...updated.telemetry,
    };
  }

  /**
   * Remove the emergency freeze from a payout destination. The account must
   * still be verified and active to be used for payouts.
   */
  async unfreezePayoutAccount(
    reviewerId: string,
    reviewerRole: string,
    payoutAccountId: string,
    reason?: string,
  ) {
    const account = await this.prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!account) throw new NotFoundException('Payout account not found');
    // Idempotency guard: reject un-unfreeze with 409 Conflict (see freezePayoutAccount).
    if (!account.isFrozen) throw new ConflictException('Payout account is not frozen');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payoutAccount.update({
        where: { id: payoutAccountId },
        data: { isFrozen: false },
      });
      await this.audit.logStrict(
        {
          actorId: reviewerId,
          actorRole: reviewerRole,
          action: 'payout_account_unfrozen',
          targetType: 'payout_account',
          targetId: payoutAccountId,
          beforeSnap: {
            isFrozen: account.isFrozen,
            isVerified: account.isVerified,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
          },
          afterSnap: {
            isFrozen: false,
            provider: account.provider,
            destination: account.destination,
            userEmail: account.user?.email ?? null,
            reason: reason ?? null,
          },
        },
        tx,
      );
      return row;
    });
    return updated;
  }
}
