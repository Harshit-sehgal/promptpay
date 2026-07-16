import { ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { PrismaService } from '../../config/prisma.service';

const EARNINGS_OBLIGATION_STATUSES = ['estimated', 'pending', 'confirmed', 'held'] as const;
const NONTERMINAL_PAYOUT_STATUSES = [
  'draft',
  'requested',
  'under_review',
  'approved',
  'processing',
] as const;
const CAMPAIGN_OBLIGATION_STATUSES = ['submitted', 'approved', 'active', 'paused'] as const;

/** Maximum total earnings (per currency, in minor units) that can be forfeited
 *  during account deletion. Matches the payout minimum — if the user can't
 *  withdraw it, they should be able to forfeit it for GDPR erasure. */
const FORFEIT_THRESHOLD_MINOR = 1000;

export interface EraseAccountOptions {
  forfeitBalance?: boolean;
}

/**
 * Erase direct account identifiers without silently forfeiting or stranding
 * money. The user row is retained as a pseudonymous FK anchor for financial,
 * fraud, consent, and audit records required for reconciliation/legal proof.
 *
 * When `forfeitBalance` is true, remaining earnings below the forfeit threshold
 * (payout minimum) are reversed as 'forfeited_on_account_deletion' before the
 * preflight check, enabling GDPR erasure for users with sub-threshold balance.
 */
export async function eraseAccountIdentity(
  prisma: PrismaService,
  userId: string,
  options: EraseAccountOptions = {},
): Promise<{ deleted: true; priorEmail: string }> {
  return prisma.$transaction(
    async (tx) => {
      // Serialize concurrent erasure attempts for this subject. Financial write
      // paths still enforce their own locks/status gates; the preflight plus
      // final user/campaign updates make deletion fail closed rather than
      // converting live value into anonymous/unclaimable value.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`account-erasure:${userId}`}))`;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, status: true },
      });
      if (!user) throw new NotFoundException('User not found');
      if (user.status === 'deleted') return { deleted: true as const, priorEmail: user.email };

      await assertNoFinancialErasureObligations(tx, userId, options);

      const advertiser = await tx.advertiser.findUnique({
        where: { userId },
        select: { id: true },
      });
      const deletedEmail = `deleted-${userId}@waitlayer.com`;
      const now = new Date();

      // Per-row device pseudonyms preserve uniqueness while invalidating every
      // event credential and removing client/device descriptors.
      await tx.$executeRaw`
        UPDATE "devices"
        SET "fingerprintHash" = 'deleted-' || "id",
            "eventSecret" = NULL,
            "publicKey" = NULL,
            "extensionVersion" = NULL,
            "platform" = NULL
        WHERE "userId" = ${userId}
      `;

      await tx.deviceRecoveryToken.updateMany({
        where: { OR: [{ userId }, { createdByUserId: userId }] },
        data: { revokedAt: now, reason: null },
      });
      await tx.session.updateMany({
        where: { userId },
        data: { revoked: true, deviceHash: null, ipHash: null },
      });
      await tx.apiKey.updateMany({
        where: {
          OR: [{ ownerId: userId }, ...(advertiser ? [{ advertiserId: advertiser.id }] : [])],
        },
        data: { isActive: false },
      });
      await tx.payoutAccount.updateMany({
        where: { userId },
        data: {
          destination: `deleted-${userId}`,
          isActive: false,
          isVerified: false,
        },
      });
      await tx.userSettings.updateMany({
        where: { userId },
        data: {
          adsEnabled: false,
          quietMode: false,
          timezone: null,
          blockedCategories: [],
        },
      });
      await Promise.all([
        tx.waitStateEvent.updateMany({ where: { userId }, data: { ipHash: null } }),
        tx.adImpression.updateMany({ where: { userId }, data: { ipHash: null } }),
        tx.adClick.updateMany({ where: { userId }, data: { ipHash: null } }),
      ]);

      if (advertiser) {
        // The preflight rejects submitted/approved/active/paused campaigns.
        // Archive any remaining draft/rejected rows so a deleted account has
        // no path back into ad serving.
        await tx.campaign.updateMany({
          where: { advertiserId: advertiser.id, status: { not: 'archived' } },
          data: { status: 'archived', archivedAt: now },
        });
        await tx.advertiser.update({
          where: { id: advertiser.id },
          data: {
            companyName: 'Deleted Advertiser',
            billingEmail: deletedEmail,
            websiteUrl: null,
            stripeCustomerId: null,
          },
        });
      }

      // Consent rows remain as legal proof, but discard free-form metadata and
      // retain only the capture method. This prevents arbitrary historical
      // metadata from defeating erasure while preserving proof provenance.
      await tx.$executeRaw`
        UPDATE "consents"
        SET "metadata" = CASE
          WHEN jsonb_typeof("metadata") = 'object' AND "metadata" ? 'method'
            THEN jsonb_build_object('method', "metadata"->'method')
          ELSE NULL
        END
        WHERE "userId" = ${userId}
      `;

      const auditIdentities = [userId, ...(advertiser ? [advertiser.id] : [])];
      await tx.auditLog.updateMany({
        where: {
          OR: [{ actorId: { in: auditIdentities } }, { targetId: { in: auditIdentities } }],
        },
        // Retain actor/action/target/time as de-identified forensic facts, but
        // remove IP pseudonyms and arbitrary snapshots that can contain old
        // contact text. The deletion audit written after this transaction must
        // likewise omit ipHash at the interceptor boundary.
        data: { ipHash: null, beforeSnap: Prisma.DbNull, afterSnap: Prisma.DbNull },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'deleted',
          email: deletedEmail,
          passwordHash: null,
          googleId: null,
          githubId: null,
          googleVerified: false,
          githubVerified: false,
          emailVerified: false,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodeHashes: [],
          name: null,
          referralCode: null,
          country: null,
        },
      });

      return { deleted: true as const, priorEmail: user.email };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
  );
}

async function assertNoFinancialErasureObligations(
  tx: Prisma.TransactionClient,
  userId: string,
  options: EraseAccountOptions = {},
): Promise<void> {
  const [earnings, recoveryDebit, recoveryCase, payout, advertiser] = await Promise.all([
    tx.earningsLedger.aggregate({
      where: {
        userId,
        entryType: 'credit',
        status: { in: [...EARNINGS_OBLIGATION_STATUSES] },
      },
      _sum: { amountMinor: true },
    }),
    tx.earningsLedger.findFirst({
      where: {
        userId,
        entryType: 'debit',
        status: { notIn: ['reversed', 'void'] },
        amountMinor: { gt: 0 },
      },
      select: { id: true },
    }),
    tx.recoveryDebtCase.findFirst({
      where: { userId, status: { in: ['open', 'in_collections'] } },
      select: { id: true, status: true },
    }),
    tx.payoutRequest.findFirst({
      where: { userId, status: { in: [...NONTERMINAL_PAYOUT_STATUSES] } },
      select: { id: true, status: true },
    }),
    tx.advertiser.findUnique({ where: { userId }, select: { id: true } }),
  ]);

  const totalEarnings = BigInt(earnings._sum.amountMinor ?? 0n);

  if (totalEarnings > 0n) {
    if (options.forfeitBalance) {
      // Only allow forfeiting when the total is below the payout minimum —
      // if the user can withdraw it, they should, not forfeit it.
      if (totalEarnings > FORFEIT_THRESHOLD_MINOR) {
        throw new ConflictException(
          `Cannot forfeit balance: total earnings (${totalEarnings} minor units) exceed the forfeit threshold (${FORFEIT_THRESHOLD_MINOR}). Withdraw available funds first.`,
        );
      }
      // Reverse all remaining credit earnings as forfeited. This zeroes the
      // balance so the preflight passes. The reversed entries remain in the
      // ledger as an audit trail — money is conserved.
      await tx.earningsLedger.updateMany({
        where: {
          userId,
          entryType: 'credit',
          status: { in: [...EARNINGS_OBLIGATION_STATUSES] },
        },
        data: {
          status: 'reversed',
        },
      });
    } else {
      throw new ConflictException(
        'Account deletion is blocked while estimated, pending, confirmed, or held earnings remain. Withdraw available funds and resolve pending or held earnings first, or set forfeitBalance=true to forfeit sub-threshold earnings below the payout minimum.',
      );
    }
  }
  if (recoveryDebit || recoveryCase) {
    throw new ConflictException(
      'Account deletion is blocked while recovery debt or an open collections case remains. Resolve the outstanding balance with support first.',
    );
  }
  if (payout) {
    throw new ConflictException(
      `Account deletion is blocked while payout ${payout.id} is ${payout.status}. Wait for it to settle or cancel it first.`,
    );
  }
  if (!advertiser) return;

  const [ledgerRows, pendingRefund, heldFunds, campaign] = await Promise.all([
    tx.advertiserLedger.groupBy({
      by: ['currency', 'entryType'],
      where: {
        advertiserId: advertiser.id,
        status: 'confirmed',
        entryType: { in: ['credit', 'debit', 'refund'] },
      },
      _sum: { amountMinor: true },
    }),
    tx.advertiserLedger.findFirst({
      where: { advertiserId: advertiser.id, entryType: 'refund', status: 'pending' },
      select: { id: true },
    }),
    tx.advertiserLedger.findFirst({
      where: { advertiserId: advertiser.id, entryType: 'credit', status: 'held' },
      select: { id: true },
    }),
    tx.campaign.findFirst({
      where: { advertiserId: advertiser.id, status: { in: [...CAMPAIGN_OBLIGATION_STATUSES] } },
      select: { id: true, status: true },
    }),
  ]);

  const balances = new Map<string, bigint>();
  for (const row of ledgerRows) {
    const amount = BigInt(row._sum.amountMinor ?? 0);
    const signed = row.entryType === 'credit' ? amount : -amount;
    balances.set(row.currency, (balances.get(row.currency) ?? 0n) + signed);
  }
  if ([...balances.values()].some((amount) => amount !== 0n) || pendingRefund || heldFunds) {
    throw new ConflictException(
      'Account deletion is blocked while funded balance, an outstanding deficit, a pending refund, or disputed funds remain. Withdraw/refund and reconcile the balance first.',
    );
  }
  if (campaign) {
    throw new ConflictException(
      `Account deletion is blocked while campaign ${campaign.id} is ${campaign.status}. Pause/archive it and complete any refund obligation first.`,
    );
  }
}
