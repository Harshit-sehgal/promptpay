import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '@waitlayer/db';

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

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.environmentKind = config.get<string>('WAITLAYER_ENVIRONMENT_KIND', 'development');
    this.environmentId = config.get<string>('WAITLAYER_ENVIRONMENT_ID', 'local');
  }

  async getCredits(userId: string) {
    this.assertSandboxEnvironment();
    const account = await this.prisma.sandboxCreditAccount.findUnique({
      where: { userId },
      select: { balanceMinor: true, currency: true, environmentId: true },
    });
    if (!account || account.environmentId !== this.environmentId) {
      return this.response(0n, 0n);
    }
    return this.response(account.balanceMinor, undefined, account.currency);
  }

  async claimFaucet(userId: string, idempotencyKey: string) {
    this.assertSandboxEnvironment();
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Serialize grants for one account. The lock is scoped to this database
        // and user, and cannot affect any production ledger path.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.environmentId}:${userId}`}, 0))`;
        const existing = await tx.sandboxCreditEntry.findUnique({
          where: { idempotencyKey },
          select: { amountMinor: true, account: { select: { balanceMinor: true } } },
        });
        if (existing) {
          return {
            balanceMinor: existing.account.balanceMinor,
            grantedMinor: existing.amountMinor,
            duplicate: true,
          };
        }

        const account = await tx.sandboxCreditAccount.upsert({
          where: { userId },
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
          select: { amountMinor: true },
        });
        const updated = await tx.sandboxCreditAccount.update({
          where: { id: account.id },
          data: { balanceMinor: { increment: entry.amountMinor } },
          select: { balanceMinor: true },
        });
        return {
          balanceMinor: updated.balanceMinor,
          grantedMinor: entry.amountMinor,
          duplicate: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.environmentId}:${userId}`}, 0))`;
        const existing = await tx.sandboxPayoutSimulation.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          select: {
            id: true,
            status: true,
            amountMinor: true,
            currency: true,
            providerTxId: true,
            account: { select: { balanceMinor: true } },
          },
        });
        if (existing)
          return { ...existing, balanceMinor: existing.account.balanceMinor, duplicate: true };

        const account = await tx.sandboxCreditAccount.findUnique({
          where: { userId },
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
        return { ...simulation, balanceMinor: updated.balanceMinor, duplicate: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.environmentId}:${userId}`}, 0))`;
        const existing = await tx.sandboxDepositSimulation.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          select: {
            id: true,
            status: true,
            amountMinor: true,
            currency: true,
            providerTxId: true,
            account: { select: { balanceMinor: true } },
          },
        });
        if (existing)
          return { ...existing, balanceMinor: existing.account.balanceMinor, duplicate: true };

        const account = await tx.sandboxCreditAccount.upsert({
          where: { userId },
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
        return { ...simulation, balanceMinor: updated.balanceMinor, duplicate: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
}
