import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { isSerializationError } from '../common/utils/errors';
import { PrismaService } from '../config/prisma.service';
import type { SandboxDepositDto, SandboxPayoutDto } from './sandbox.dto';

const TEST_CURRENCY = 'XTS' as const;
const FAUCET_GRANT_MINOR = 10_000n;
const MAX_BALANCE_MINOR = 100_000n;
const MAX_GRANTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class SandboxService {
  private readonly environmentKind: string;
  private readonly environmentId: string;
  private readonly resetToken: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.environmentKind = config.get<string>('WAITLAYER_ENVIRONMENT_KIND', 'development');
    this.environmentId = config.get<string>('WAITLAYER_ENVIRONMENT_ID', 'local');
    this.resetToken = config.get<string>('SANDBOX_RESET_TOKEN');
  }

  async getCredits(userId: string) {
    this.assertSandboxEnvironment();
    const account = await this.prisma.sandboxCreditAccount.findUnique({
      where: { userId_environmentId: { userId, environmentId: this.environmentId } },
      select: { balanceMinor: true, currency: true, environmentId: true },
    });
    if (!account || account.environmentId !== this.environmentId) {
      return this.response(0n, 0n);
    }
    return this.response(account.balanceMinor, undefined, account.currency);
  }

  async claimFaucet(userId: string, idempotencyKey: string) {
    this.assertSandboxEnvironment();
    const result = await this.runSerializable(async (tx) => {
      // Serialize grants for one account. The lock is scoped to this database
      // and user, and cannot affect any production ledger path.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.environmentId}:${userId}`}, 0))`;
      const account = await tx.sandboxCreditAccount.upsert({
        where: { userId_environmentId: { userId, environmentId: this.environmentId } },
        create: {
          userId,
          environmentId: this.environmentId,
          currency: TEST_CURRENCY,
          balanceMinor: 0n,
        },
        update: {},
        select: { id: true, environmentId: true, currency: true, balanceMinor: true },
      });
      if (account.environmentId !== this.environmentId || account.currency !== TEST_CURRENCY) {
        throw new ForbiddenException('Sandbox credit account environment mismatch');
      }
      const operation = await this.claimSandboxOperation(tx, account.id, idempotencyKey, 'faucet', {
        grantMinor: FAUCET_GRANT_MINOR.toString(),
      });
      if (operation.completedAt) {
        if (operation.resultBalanceMinor === null) {
          throw new ConflictException('Sandbox operation result is unavailable');
        }
        if (operation.resultStatus === 'exhausted') {
          if (operation.resultId !== null) {
            throw new ConflictException('Sandbox faucet result linkage is inconsistent');
          }
          return {
            balanceMinor: operation.resultBalanceMinor,
            grantedMinor: 0n,
            duplicate: true,
            exhausted: true,
          };
        }
        if (operation.resultStatus !== 'granted' || !operation.resultId) {
          throw new ConflictException('Sandbox faucet result linkage is inconsistent');
        }
        const entry = await tx.sandboxCreditEntry.findUnique({
          where: { id: operation.resultId },
          select: {
            id: true,
            accountId: true,
            amountMinor: true,
            entryType: true,
            environmentId: true,
            idempotencyKey: true,
          },
        });
        if (
          !entry ||
          entry.accountId !== account.id ||
          entry.environmentId !== this.environmentId ||
          entry.entryType !== 'faucet' ||
          entry.idempotencyKey !== idempotencyKey ||
          entry.amountMinor !== FAUCET_GRANT_MINOR
        ) {
          throw new ConflictException('Sandbox faucet result linkage is inconsistent');
        }
        return {
          balanceMinor: operation.resultBalanceMinor,
          grantedMinor: entry.amountMinor,
          duplicate: true,
          exhausted: false,
        };
      }
      const existing = await tx.sandboxCreditEntry.findUnique({
        where: {
          accountId_idempotencyKey: { accountId: account.id, idempotencyKey },
        },
        select: {
          id: true,
          accountId: true,
          amountMinor: true,
          entryType: true,
          environmentId: true,
          idempotencyKey: true,
        },
      });
      if (existing) {
        if (
          existing.accountId !== account.id ||
          existing.entryType !== 'faucet' ||
          existing.environmentId !== this.environmentId ||
          existing.idempotencyKey !== idempotencyKey ||
          existing.amountMinor !== FAUCET_GRANT_MINOR
        ) {
          throw new ConflictException('Sandbox idempotency key belongs to another operation');
        }
        await this.completeSandboxOperation(tx, operation.id, {
          resultBalanceMinor: account.balanceMinor,
          resultId: existing.id,
          resultStatus: 'granted',
        });
        return {
          balanceMinor: account.balanceMinor,
          grantedMinor: existing.amountMinor,
          duplicate: true,
        };
      }
      const since = new Date(Date.now() - DAY_MS);
      const [grantCount, aggregate] = await Promise.all([
        tx.sandboxCreditEntry.count({
          where: { accountId: account.id, entryType: 'faucet', createdAt: { gte: since } },
        }),
        tx.sandboxCreditEntry.aggregate({
          where: { accountId: account.id, entryType: 'faucet' },
          _sum: { amountMinor: true },
        }),
      ]);
      const grantedTotal = aggregate._sum.amountMinor ?? 0n;
      if (
        grantCount >= MAX_GRANTS_PER_DAY ||
        grantedTotal + FAUCET_GRANT_MINOR > MAX_BALANCE_MINOR
      ) {
        await this.completeSandboxOperation(tx, operation.id, {
          resultBalanceMinor: account.balanceMinor,
          resultStatus: 'exhausted',
        });
        return {
          balanceMinor: account.balanceMinor,
          grantedMinor: 0n,
          duplicate: false,
          exhausted: true,
        };
      }
      const entry = await tx.sandboxCreditEntry.create({
        data: {
          accountId: account.id,
          environmentId: this.environmentId,
          currency: TEST_CURRENCY,
          entryType: 'faucet',
          amountMinor: FAUCET_GRANT_MINOR,
          idempotencyKey,
          metadata: { source: 'sandbox_faucet_v1' } as Prisma.InputJsonValue,
        },
        select: { id: true, amountMinor: true },
      });
      const updated = await tx.sandboxCreditAccount.update({
        where: { id: account.id },
        data: { balanceMinor: { increment: entry.amountMinor } },
        select: { balanceMinor: true },
      });
      await this.completeSandboxOperation(tx, operation.id, {
        resultBalanceMinor: updated.balanceMinor,
        resultId: entry.id,
        resultStatus: 'granted',
      });
      return {
        balanceMinor: updated.balanceMinor,
        grantedMinor: entry.amountMinor,
        duplicate: false,
      };
    });
    return this.response(
      result.balanceMinor,
      result.grantedMinor,
      TEST_CURRENCY,
      result.duplicate,
      result.exhausted,
    );
  }

  async simulatePayout(userId: string, dto: SandboxPayoutDto) {
    this.assertSandboxEnvironment();
    const result = await this.runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.environmentId}:${userId}`}, 0))`;
      const account = await tx.sandboxCreditAccount.findUnique({
        where: { userId_environmentId: { userId, environmentId: this.environmentId } },
        select: { id: true, environmentId: true, currency: true, balanceMinor: true },
      });
      if (
        !account ||
        account.environmentId !== this.environmentId ||
        account.currency !== TEST_CURRENCY
      ) {
        throw new BadRequestException(
          'Claim sandbox faucet credits before requesting a sandbox payout',
        );
      }
      const operation = await this.claimSandboxOperation(
        tx,
        account.id,
        dto.idempotencyKey,
        'payout',
        {
          amountMinor: BigInt(dto.amountMinor).toString(),
          destinationAlias: dto.destinationAlias,
          outcome: dto.outcome,
        },
      );
      const existing = await tx.sandboxPayoutSimulation.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: account.id,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          providerTxId: true,
          destinationAlias: true,
          requestedOutcome: true,
        },
      });
      if (existing) {
        if (
          existing.amountMinor !== BigInt(dto.amountMinor) ||
          existing.destinationAlias !== dto.destinationAlias ||
          existing.requestedOutcome !== dto.outcome
        ) {
          throw new ConflictException(
            'Sandbox idempotency key payload does not match the original request',
          );
        }
        if (operation.completedAt && operation.resultBalanceMinor === null) {
          throw new ConflictException('Sandbox operation result is unavailable');
        }
        if (
          operation.completedAt &&
          (operation.resultId !== existing.id || operation.resultStatus !== existing.status)
        ) {
          throw new ConflictException('Sandbox operation result does not match the simulation');
        }
        if (!operation.completedAt) {
          throw new ConflictException('Sandbox operation and simulation state are inconsistent');
        }
        const resultBalanceMinor = operation.resultBalanceMinor;
        if (resultBalanceMinor === null) {
          throw new ConflictException('Sandbox operation result is unavailable');
        }
        return {
          ...existing,
          balanceMinor: resultBalanceMinor,
          duplicate: true,
        };
      }
      if (operation.completedAt) {
        throw new ConflictException('Sandbox operation result is unavailable');
      }
      const amountMinor = BigInt(dto.amountMinor);
      if (account.balanceMinor < amountMinor)
        throw new BadRequestException('Insufficient sandbox credits');
      const id = randomUUID();
      const finalStatus =
        dto.outcome === 'paid' || dto.outcome === 'duplicate_callback'
          ? 'paid'
          : dto.outcome === 'processing' || dto.outcome === 'callback_before_response'
            ? 'processing'
            : ['ambiguous', 'timeout', 'reconciliation_escalation'].includes(dto.outcome)
              ? 'requires_review'
              : dto.outcome;
      const providerTxId = `sandbox_${dto.outcome}_${id}`;
      await tx.sandboxCreditEntry.create({
        data: {
          accountId: account.id,
          environmentId: this.environmentId,
          currency: TEST_CURRENCY,
          entryType: 'payout_debit',
          amountMinor,
          idempotencyKey: `${dto.idempotencyKey}:debit`,
          metadata: { simulationId: id, outcome: dto.outcome } as Prisma.InputJsonValue,
        },
      });
      const refunded = dto.outcome === 'failed' || dto.outcome === 'reversed';
      if (refunded) {
        await tx.sandboxCreditEntry.create({
          data: {
            accountId: account.id,
            environmentId: this.environmentId,
            currency: TEST_CURRENCY,
            entryType: 'payout_refund',
            amountMinor,
            idempotencyKey: `${dto.idempotencyKey}:refund`,
            metadata: { simulationId: id, outcome: dto.outcome } as Prisma.InputJsonValue,
          },
        });
      }
      const updated = await tx.sandboxCreditAccount.update({
        where: { id: account.id },
        data: { balanceMinor: refunded ? account.balanceMinor : { decrement: amountMinor } },
        select: { balanceMinor: true },
      });
      const simulation = await tx.sandboxPayoutSimulation.create({
        data: {
          id,
          userId,
          accountId: account.id,
          environmentId: this.environmentId,
          currency: TEST_CURRENCY,
          amountMinor,
          destinationAlias: dto.destinationAlias,
          requestedOutcome: dto.outcome,
          status: finalStatus,
          providerTxId,
          idempotencyKey: dto.idempotencyKey,
        },
        select: { id: true, status: true, amountMinor: true, currency: true, providerTxId: true },
      });
      await this.completeSandboxOperation(tx, operation.id, {
        resultBalanceMinor: updated.balanceMinor,
        resultId: simulation.id,
        resultStatus: simulation.status,
      });
      return { ...simulation, balanceMinor: updated.balanceMinor, duplicate: false };
    });
    return {
      mode: 'sandbox' as const,
      hasCashValue: false as const,
      environmentId: this.environmentId,
      duplicate: result.duplicate,
      simulationId: result.id,
      status: result.status,
      providerTxId: result.providerTxId,
      amountMinor: result.amountMinor.toString(),
      currency: result.currency,
      balanceMinor: result.balanceMinor.toString(),
      label: 'Test payout only — no external transfer or cash value',
    };
  }

  async simulateDeposit(userId: string, dto: SandboxDepositDto) {
    this.assertSandboxEnvironment();
    const result = await this.runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.environmentId}:${userId}`}, 0))`;
      const account = await tx.sandboxCreditAccount.upsert({
        where: { userId_environmentId: { userId, environmentId: this.environmentId } },
        create: {
          userId,
          environmentId: this.environmentId,
          currency: TEST_CURRENCY,
          balanceMinor: 0n,
        },
        update: {},
        select: { id: true, environmentId: true, currency: true, balanceMinor: true },
      });
      if (account.environmentId !== this.environmentId || account.currency !== TEST_CURRENCY)
        throw new ForbiddenException('Sandbox credit account environment mismatch');

      const operation = await this.claimSandboxOperation(
        tx,
        account.id,
        dto.idempotencyKey,
        'deposit',
        {
          amountMinor: BigInt(dto.amountMinor).toString(),
          outcome: dto.outcome,
        },
      );
      const existing = await tx.sandboxDepositSimulation.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: account.id,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: {
          id: true,
          status: true,
          amountMinor: true,
          currency: true,
          providerTxId: true,
          requestedOutcome: true,
        },
      });
      if (existing) {
        if (
          existing.amountMinor !== BigInt(dto.amountMinor) ||
          existing.requestedOutcome !== dto.outcome
        ) {
          throw new ConflictException(
            'Sandbox idempotency key payload does not match the original request',
          );
        }
        if (operation.completedAt && operation.resultBalanceMinor === null) {
          throw new ConflictException('Sandbox operation result is unavailable');
        }
        if (
          operation.completedAt &&
          (operation.resultId !== existing.id || operation.resultStatus !== existing.status)
        ) {
          throw new ConflictException('Sandbox operation result does not match the simulation');
        }
        if (!operation.completedAt) {
          throw new ConflictException('Sandbox operation and simulation state are inconsistent');
        }
        const resultBalanceMinor = operation.resultBalanceMinor;
        if (resultBalanceMinor === null) {
          throw new ConflictException('Sandbox operation result is unavailable');
        }
        return {
          ...existing,
          balanceMinor: resultBalanceMinor,
          duplicate: true,
        };
      }
      if (operation.completedAt) {
        throw new ConflictException('Sandbox operation result is unavailable');
      }

      const amountMinor = BigInt(dto.amountMinor);
      const credited = [
        'approved',
        'refunded',
        'disputed',
        'duplicate_callback',
        'delayed_callback',
        'callback_before_response',
      ].includes(dto.outcome);
      if (credited && account.balanceMinor + amountMinor > MAX_BALANCE_MINOR)
        throw new BadRequestException('Sandbox credit balance cap exceeded');

      const id = randomUUID();
      if (credited) {
        await tx.sandboxCreditEntry.create({
          data: {
            accountId: account.id,
            environmentId: this.environmentId,
            currency: TEST_CURRENCY,
            entryType: 'deposit_credit',
            amountMinor,
            idempotencyKey: `${dto.idempotencyKey}:credit`,
            metadata: { simulationId: id, outcome: dto.outcome } as Prisma.InputJsonValue,
          },
        });
      }
      const reversed = dto.outcome === 'refunded' || dto.outcome === 'disputed';
      if (reversed) {
        await tx.sandboxCreditEntry.create({
          data: {
            accountId: account.id,
            environmentId: this.environmentId,
            currency: TEST_CURRENCY,
            entryType: dto.outcome === 'disputed' ? 'deposit_chargeback' : 'deposit_refund',
            amountMinor,
            idempotencyKey: `${dto.idempotencyKey}:reversal`,
            metadata: { simulationId: id, outcome: dto.outcome } as Prisma.InputJsonValue,
          },
        });
      }
      const updated =
        credited && !reversed
          ? await tx.sandboxCreditAccount.update({
              where: { id: account.id },
              data: { balanceMinor: { increment: amountMinor } },
              select: { balanceMinor: true },
            })
          : { balanceMinor: account.balanceMinor };
      const simulation = await tx.sandboxDepositSimulation.create({
        data: {
          id,
          userId,
          accountId: account.id,
          environmentId: this.environmentId,
          currency: TEST_CURRENCY,
          amountMinor,
          requestedOutcome: dto.outcome,
          status: dto.outcome,
          providerTxId: `sandbox_deposit_${dto.outcome}_${id}`,
          idempotencyKey: dto.idempotencyKey,
        },
        select: { id: true, status: true, amountMinor: true, currency: true, providerTxId: true },
      });
      await this.completeSandboxOperation(tx, operation.id, {
        resultBalanceMinor: updated.balanceMinor,
        resultId: simulation.id,
        resultStatus: simulation.status,
      });
      return { ...simulation, balanceMinor: updated.balanceMinor, duplicate: false };
    });
    return {
      mode: 'sandbox' as const,
      hasCashValue: false as const,
      environmentId: this.environmentId,
      duplicate: result.duplicate,
      simulationId: result.id,
      status: result.status,
      providerTxId: result.providerTxId,
      amountMinor: result.amountMinor.toString(),
      currency: result.currency,
      balanceMinor: result.balanceMinor.toString(),
      label: 'Test deposit only — no external transfer or cash value',
    };
  }

  async listPayouts(userId: string) {
    this.assertSandboxEnvironment();
    const rows = await this.prisma.sandboxPayoutSimulation.findMany({
      where: { userId, environmentId: this.environmentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        destinationAlias: true,
        requestedOutcome: true,
        status: true,
        providerTxId: true,
        createdAt: true,
      },
    });
    return {
      mode: 'sandbox' as const,
      hasCashValue: false as const,
      environmentId: this.environmentId,
      payouts: rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })),
      label: 'Test payouts only — no cash value',
    };
  }

  async listDeposits(userId: string) {
    this.assertSandboxEnvironment();
    const rows = await this.prisma.sandboxDepositSimulation.findMany({
      where: { userId, environmentId: this.environmentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        requestedOutcome: true,
        status: true,
        providerTxId: true,
        createdAt: true,
      },
    });
    return {
      mode: 'sandbox' as const,
      hasCashValue: false as const,
      environmentId: this.environmentId,
      deposits: rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() })),
      label: 'Test deposits only — no cash value',
    };
  }

  /**
   * Produce a read-only, environment-scoped accounting report. Positive
   * sandbox entries are intentionally classified here rather than inferred
   * from current balances, so a reset or a disputed/refunded simulation never
   * hides historical accounting drift.
   */
  async reconcile(environmentId = this.environmentId) {
    this.assertSandboxEnvironment();
    this.assertEnvironmentId(environmentId);
    const [accounts, entries] = await Promise.all([
      this.prisma.sandboxCreditAccount.findMany({
        where: { environmentId, currency: TEST_CURRENCY },
        select: { id: true, userId: true, currency: true, balanceMinor: true },
      }),
      this.prisma.sandboxCreditEntry.findMany({
        where: { environmentId, currency: TEST_CURRENCY },
        select: { accountId: true, currency: true, entryType: true, amountMinor: true },
      }),
    ]);
    const byAccount = new Map<string, { minted: bigint; burned: bigint }>();
    for (const account of accounts) byAccount.set(account.id, { minted: 0n, burned: 0n });
    for (const entry of entries) {
      const totals = byAccount.get(entry.accountId);
      if (!totals) continue;
      if (isMintedEntry(entry.entryType)) totals.minted += entry.amountMinor;
      else if (isBurnedEntry(entry.entryType)) totals.burned += entry.amountMinor;
    }
    const accountsReport = accounts.map((account) => {
      const totals = byAccount.get(account.id) ?? { minted: 0n, burned: 0n };
      const expectedBalanceMinor = totals.minted - totals.burned;
      return {
        accountId: account.id,
        userId: account.userId,
        currency: account.currency,
        recordedBalanceMinor: account.balanceMinor,
        expectedBalanceMinor,
        discrepancyMinor: account.balanceMinor - expectedBalanceMinor,
        status: account.balanceMinor === expectedBalanceMinor ? 'healthy' : 'unhealthy',
      };
    });
    const totals = accountsReport.reduce(
      (sum, account) => ({
        mintedMinor: sum.mintedMinor + (byAccount.get(account.accountId)?.minted ?? 0n),
        burnedMinor: sum.burnedMinor + (byAccount.get(account.accountId)?.burned ?? 0n),
        recordedBalanceMinor: sum.recordedBalanceMinor + account.recordedBalanceMinor,
        expectedBalanceMinor: sum.expectedBalanceMinor + account.expectedBalanceMinor,
        discrepancyMinor: sum.discrepancyMinor + account.discrepancyMinor,
      }),
      {
        mintedMinor: 0n,
        burnedMinor: 0n,
        recordedBalanceMinor: 0n,
        expectedBalanceMinor: 0n,
        discrepancyMinor: 0n,
      },
    );
    return {
      mode: 'sandbox' as const,
      environmentId,
      currency: TEST_CURRENCY,
      status: accountsReport.every((account) => account.status === 'healthy')
        ? 'healthy'
        : 'unhealthy',
      accountCount: accountsReport.length,
      totals,
      accounts: accountsReport,
      label: 'Sandbox reconciliation — test credits only, no cash value',
    };
  }

  /**
   * Reset one isolated sandbox environment. The reset token is compared in
   * constant time and all deletes are performed inside one serializable
   * transaction while the same environment lock used by mutations is held.
   */
  async reset(
    environmentId: string,
    resetToken: string,
    actor: { actorId: string; actorRole: string },
  ) {
    this.assertSandboxEnvironment();
    this.assertEnvironmentId(environmentId);
    this.assertResetToken(resetToken);
    const result = await this.runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reset:${environmentId}`}, 0))`;
      const where = { environmentId };
      // Delete dependents before their account/entry parents. Keep these
      // sequential: Promise.all can issue the deletes in an arbitrary order
      // and turn a valid reset into a foreign-key race.
      const payouts = await tx.sandboxPayoutSimulation.deleteMany({ where });
      const deposits = await tx.sandboxDepositSimulation.deleteMany({ where });
      const operations = await tx.sandboxOperation.deleteMany({ where });
      const entries = await tx.sandboxCreditEntry.deleteMany({ where });
      const accounts = await tx.sandboxCreditAccount.deleteMany({ where });
      const deleted = {
        payouts: payouts.count,
        deposits: deposits.count,
        operations: operations.count,
        entries: entries.count,
        accounts: accounts.count,
      };
      await this.audit.logStrict(
        {
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          action: 'sandbox_reset',
          targetType: 'sandbox_environment',
          targetId: environmentId,
          afterSnap: { environmentId, deleted } as Prisma.InputJsonValue,
        },
        tx,
      );
      return deleted;
    });
    return {
      mode: 'sandbox' as const,
      environmentId,
      reset: true as const,
      deleted: result,
      label: 'Sandbox reset completed — test records only, no cash value',
    };
  }

  private async claimSandboxOperation(
    tx: Prisma.TransactionClient,
    accountId: string,
    idempotencyKey: string,
    operationType: string,
    payload: Record<string, string>,
  ): Promise<{
    id: string;
    completedAt: Date | null;
    resultBalanceMinor: bigint | null;
    resultId: string | null;
    resultStatus: string | null;
  }> {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({ operationType, payload }))
      .digest('hex');
    const existing = await tx.sandboxOperation.findUnique({
      where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
      select: {
        id: true,
        operationType: true,
        payloadHash: true,
        completedAt: true,
        resultBalanceMinor: true,
        resultId: true,
        resultStatus: true,
      },
    });
    if (existing) {
      if (existing.operationType !== operationType || existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          'Sandbox idempotency key payload does not match the original request',
        );
      }
      if (!existing.completedAt) {
        throw new ConflictException('Sandbox operation is still in progress');
      }
      return existing;
    }
    return tx.sandboxOperation.create({
      data: {
        accountId,
        environmentId: this.environmentId,
        idempotencyKey,
        operationType,
        payloadHash,
      },
      select: {
        id: true,
        completedAt: true,
        resultBalanceMinor: true,
        resultId: true,
        resultStatus: true,
      },
    });
  }

  private completeSandboxOperation(
    tx: Prisma.TransactionClient,
    operationId: string,
    result: {
      resultBalanceMinor: bigint;
      resultId?: string;
      resultStatus: string;
    },
  ) {
    return tx.sandboxOperation.update({
      where: { id: operationId },
      data: { ...result, completedAt: new Date() },
    });
  }

  private async runSerializable<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(callback, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error('Sandbox transaction retry loop exhausted');
  }

  private response(
    balanceMinor: bigint,
    grantedMinor: bigint = 0n,
    currency: string = TEST_CURRENCY,
    duplicate = false,
    exhausted = false,
  ) {
    return {
      mode: 'sandbox' as const,
      hasCashValue: false as const,
      currency,
      balanceMinor: balanceMinor.toString(),
      grantedMinor: Number(grantedMinor),
      duplicate,
      exhausted,
      label: 'Test credits only — no cash value',
      environmentId: this.environmentId,
    };
  }

  private assertSandboxEnvironment(): void {
    if (this.environmentKind !== 'sandbox' && this.environmentKind !== 'test') {
      throw new ForbiddenException(
        'Sandbox credits are available only in test or sandbox environments',
      );
    }
  }

  private assertEnvironmentId(environmentId: string): void {
    if (environmentId !== this.environmentId) {
      throw new ForbiddenException('Sandbox environment id does not match this deployment');
    }
  }

  private assertResetToken(candidate: string): void {
    if (!this.resetToken) throw new ForbiddenException('Sandbox reset is not configured');
    const expected = Buffer.from(this.resetToken, 'utf8');
    const actual = Buffer.from(candidate, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ForbiddenException('Invalid sandbox reset token');
    }
  }
}

function isMintedEntry(entryType: string): boolean {
  // Refund entries restore credits that were previously debited. They are
  // positive ledger rows and therefore belong on the mint side of the
  // balance equation.
  return ['faucet', 'deposit_credit', 'payout_refund'].includes(entryType);
}

function isBurnedEntry(entryType: string): boolean {
  // Deposit refunds/chargebacks remove a previously credited deposit. The
  // payout debit is later neutralized by payout_refund for failed outcomes.
  return ['payout_debit', 'deposit_refund', 'deposit_chargeback'].includes(entryType);
}

function isSerializationConflict(error: unknown): boolean {
  // Delegate to the shared classifier. The narrower `code === 'P2034'` check
  // this replaced missed the raw `DriverAdapterError`
  // (`kind: 'TransactionWriteConflict'`, no `code`) that @prisma/adapter-pg
  // throws for SQLSTATE 40001 inside an interactive transaction, so a genuine
  // serialization abort escaped the retry loop as a 500.
  return isSerializationError(error);
}
