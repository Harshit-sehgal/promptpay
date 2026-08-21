import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { SandboxService } from './sandbox.service';

function makeService(environmentKind = 'sandbox', resetToken?: string) {
  const audit = { logStrict: vi.fn().mockResolvedValue(undefined) };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    sandboxOperation: {
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockImplementation((args) => ({
        id: 'operation-1',
        completedAt: null,
        resultBalanceMinor: null,
        resultStatus: null,
        ...args.data,
      })),
      update: vi.fn().mockResolvedValue({}),
    },
    sandboxCreditEntry: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: null } }),
      create: vi.fn().mockResolvedValue({ id: 'entry-1', amountMinor: 10_000n }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    sandboxCreditAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({
        id: 'account-1',
        environmentId: 'sandbox-run-1',
        currency: 'XTS',
        balanceMinor: 0n,
      }),
      update: vi.fn().mockResolvedValue({ balanceMinor: 10_000n }),
    },
    sandboxPayoutSimulation: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({
        id: 'simulation-1',
        status: 'paid',
        amountMinor: 2_000n,
        currency: 'XTS',
        providerTxId: 'sandbox_paid_simulation-1',
      }),
    },
    sandboxDepositSimulation: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({
        id: 'deposit-1',
        status: 'approved',
        amountMinor: 5_000n,
        currency: 'XTS',
        providerTxId: 'sandbox_deposit_approved-deposit-1',
      }),
    },
  };
  const prisma = {
    sandboxCreditAccount: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    sandboxCreditEntry: { findMany: vi.fn().mockResolvedValue([]) },
    sandboxPayoutSimulation: { findMany: vi.fn() },
    sandboxDepositSimulation: { findMany: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const config = {
    get: vi.fn((key: string, fallback: string) =>
      key === 'ATEVA_ENVIRONMENT_KIND'
        ? environmentKind
        : key === 'SANDBOX_RESET_TOKEN'
          ? resetToken
          : fallback === 'local'
            ? 'sandbox-run-1'
            : fallback,
    ),
  };
  return {
    service: new SandboxService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      config as never,
    ),
    prisma,
    tx,
    audit,
  };
}

describe('SandboxService (WL-070/WL-072)', () => {
  it('fails closed outside test and sandbox environments', async () => {
    const { service, prisma } = makeService('development');

    await expect(service.getCredits('user-1')).rejects.toThrow('only in test or sandbox');
    expect(prisma.sandboxCreditAccount.findUnique).not.toHaveBeenCalled();
  });

  it('claims one fixed XTS grant and serializes the account transaction', async () => {
    const { service, tx } = makeService();

    const result = await service.claimFaucet('user-1', 'faucet-run-001');

    expect(result).toMatchObject({
      mode: 'sandbox',
      hasCashValue: false,
      currency: 'XTS',
      balanceMinor: '10000',
      grantedMinor: 10000,
      duplicate: false,
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.sandboxCreditEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: 'faucet',
          amountMinor: 10_000n,
          currency: 'XTS',
        }),
      }),
    );
  });

  it('returns the existing grant on an idempotent replay', async () => {
    const { service, tx } = makeService();
    const faucetPayloadHash = createHash('sha256')
      .update(JSON.stringify({ operationType: 'faucet', payload: { grantMinor: '10000' } }))
      .digest('hex');
    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'faucet',
      payloadHash: faucetPayloadHash,
      completedAt: new Date(),
      resultBalanceMinor: 10_000n,
      resultId: 'entry-1',
      resultStatus: 'granted',
    });
    tx.sandboxCreditAccount.upsert.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 10_000n,
    });
    tx.sandboxCreditEntry.findUnique.mockResolvedValue({
      id: 'entry-1',
      accountId: 'account-1',
      amountMinor: 10_000n,
      entryType: 'faucet',
      environmentId: 'sandbox-run-1',
      idempotencyKey: 'faucet-run-001',
    });

    const result = await service.claimFaucet('user-1', 'faucet-run-001');

    expect(result).toMatchObject({ balanceMinor: '10000', grantedMinor: 10000, duplicate: true });
    expect(tx.sandboxCreditEntry.create).not.toHaveBeenCalled();
    expect(tx.sandboxCreditAccount.update).not.toHaveBeenCalled();
    expect(tx.sandboxCreditAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_environmentId: { userId: 'user-1', environmentId: 'sandbox-run-1' } },
      }),
    );
    expect(tx.sandboxOperation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_idempotencyKey: { accountId: 'account-1', idempotencyKey: 'faucet-run-001' },
        },
      }),
    );
    expect(tx.sandboxCreditEntry.findUnique).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      select: expect.objectContaining({ id: true, idempotencyKey: true }),
    });
  });

  it('fails closed when a completed faucet operation has inconsistent result linkage', async () => {
    const { service, tx } = makeService();
    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'faucet',
      payloadHash: createHash('sha256')
        .update(JSON.stringify({ operationType: 'faucet', payload: { grantMinor: '10000' } }))
        .digest('hex'),
      completedAt: new Date(),
      resultBalanceMinor: 10_000n,
      resultId: 'missing-entry',
      resultStatus: 'granted',
    });
    tx.sandboxCreditEntry.findUnique.mockResolvedValue(null);

    await expect(service.claimFaucet('user-1', 'faucet-run-001')).rejects.toThrow(
      'result linkage is inconsistent',
    );
    expect(tx.sandboxCreditEntry.create).not.toHaveBeenCalled();
    expect(tx.sandboxCreditAccount.update).not.toHaveBeenCalled();
  });

  it('accepts an exhausted faucet replay only when its registry has no result entry', async () => {
    const { service, tx } = makeService();
    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'faucet',
      payloadHash: createHash('sha256')
        .update(JSON.stringify({ operationType: 'faucet', payload: { grantMinor: '10000' } }))
        .digest('hex'),
      completedAt: new Date(),
      resultBalanceMinor: 30_000n,
      resultId: null,
      resultStatus: 'exhausted',
    });

    const result = await service.claimFaucet('user-1', 'faucet-run-001');

    expect(result).toMatchObject({
      balanceMinor: '30000',
      grantedMinor: 0,
      duplicate: true,
      exhausted: true,
    });
    expect(tx.sandboxCreditEntry.findUnique).not.toHaveBeenCalled();
    expect(tx.sandboxCreditEntry.create).not.toHaveBeenCalled();
  });

  it('rejects an orphan simulation instead of adopting an incomplete payout operation', async () => {
    const { service, tx } = makeService();
    tx.sandboxCreditAccount.findUnique.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 8_000n,
    });
    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'payout',
      payloadHash: createHash('sha256')
        .update(
          JSON.stringify({
            operationType: 'payout',
            payload: {
              amountMinor: '2000',
              destinationAlias: 'sandbox:developer',
              outcome: 'paid',
            },
          }),
        )
        .digest('hex'),
      completedAt: null,
      resultBalanceMinor: null,
      resultId: null,
      resultStatus: null,
    });
    tx.sandboxPayoutSimulation.findUnique.mockResolvedValue({
      id: 'simulation-orphan',
      status: 'paid',
      amountMinor: 2_000n,
      currency: 'XTS',
      providerTxId: 'sandbox_paid_orphan',
      destinationAlias: 'sandbox:developer',
      requestedOutcome: 'paid',
    });

    await expect(
      service.simulatePayout('user-1', {
        amountMinor: 2_000,
        destinationAlias: 'sandbox:developer',
        outcome: 'paid',
        idempotencyKey: 'payout-run-001',
      }),
    ).rejects.toThrow('Sandbox operation is still in progress');
    expect(tx.sandboxCreditEntry.create).not.toHaveBeenCalled();
    expect(tx.sandboxCreditAccount.update).not.toHaveBeenCalled();
  });

  it('fails closed when a sandbox operation is still in progress', async () => {
    const { service, tx } = makeService();
    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'deposit',
      payloadHash: createHash('sha256')
        .update(
          JSON.stringify({
            operationType: 'deposit',
            payload: { amountMinor: '5000', outcome: 'approved' },
          }),
        )
        .digest('hex'),
      completedAt: null,
      resultBalanceMinor: null,
      resultId: null,
      resultStatus: null,
    });

    await expect(
      service.simulateDeposit('user-1', {
        amountMinor: 5_000,
        outcome: 'approved',
        idempotencyKey: 'deposit-run-001',
      }),
    ).rejects.toThrow('still in progress');
    expect(tx.sandboxDepositSimulation.create).not.toHaveBeenCalled();
  });

  it('rejects a same-account idempotency key reused for a different sandbox operation', async () => {
    const { service, tx } = makeService();
    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'faucet',
      payloadHash: 'different-payload',
      completedAt: new Date(),
      resultBalanceMinor: 10_000n,
      resultId: 'entry-1',
      resultStatus: 'granted',
    });

    await expect(
      service.simulateDeposit('user-1', {
        amountMinor: 5_000,
        outcome: 'approved',
        idempotencyKey: 'faucet-run-001',
      }),
    ).rejects.toThrow('payload does not match');
    expect(tx.sandboxDepositSimulation.create).not.toHaveBeenCalled();
  });

  it('does not issue a grant after the daily/total faucet cap', async () => {
    const { service, tx } = makeService();
    tx.sandboxCreditEntry.count.mockResolvedValue(3);
    tx.sandboxCreditAccount.upsert.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 30_000n,
    });

    const result = await service.claimFaucet('user-1', 'faucet-run-002');

    expect(result).toMatchObject({ balanceMinor: '30000', grantedMinor: 0, exhausted: true });
    expect(tx.sandboxCreditEntry.create).not.toHaveBeenCalled();
  });

  it('simulates an idempotent paid payout using XTS only', async () => {
    const { service, tx } = makeService();
    tx.sandboxCreditAccount.findUnique.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 10_000n,
    });
    tx.sandboxCreditAccount.update.mockResolvedValue({ balanceMinor: 8_000n });
    tx.sandboxPayoutSimulation.create.mockResolvedValue({
      id: 'simulation-1',
      status: 'paid',
      amountMinor: 2_000n,
      currency: 'XTS',
      providerTxId: 'sandbox_paid_simulation-1',
      destinationAlias: 'sandbox:developer',
      requestedOutcome: 'paid',
    });

    const result = await service.simulatePayout('user-1', {
      amountMinor: 2_000,
      destinationAlias: 'sandbox:developer',
      outcome: 'paid',
      idempotencyKey: 'payout-run-001',
    });

    expect(result).toMatchObject({
      mode: 'sandbox',
      hasCashValue: false,
      status: 'paid',
      balanceMinor: '8000',
    });
    expect(tx.sandboxCreditEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entryType: 'payout_debit', amountMinor: 2_000n }),
      }),
    );
    expect(tx.sandboxPayoutSimulation.create).toHaveBeenCalled();
    expect(tx.sandboxCreditAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_environmentId: { userId: 'user-1', environmentId: 'sandbox-run-1' } },
      }),
    );
    expect(tx.sandboxPayoutSimulation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_idempotencyKey: { accountId: 'account-1', idempotencyKey: 'payout-run-001' },
        },
      }),
    );
  });

  it('records failed outcomes and refunds the simulated debit', async () => {
    const { service, tx } = makeService();
    tx.sandboxCreditAccount.findUnique.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 10_000n,
    });
    tx.sandboxCreditAccount.update.mockResolvedValue({ balanceMinor: 10_000n });
    tx.sandboxPayoutSimulation.create.mockResolvedValue({
      id: 'simulation-1',
      status: 'failed',
      amountMinor: 2_000n,
      currency: 'XTS',
      providerTxId: 'sandbox_failed_simulation-1',
      destinationAlias: 'sandbox:developer',
      requestedOutcome: 'failed',
    });

    const result = await service.simulatePayout('user-1', {
      amountMinor: 2_000,
      destinationAlias: 'sandbox:developer',
      outcome: 'failed',
      idempotencyKey: 'payout-run-002',
    });

    expect(result).toMatchObject({ status: 'failed', balanceMinor: '10000' });
    expect(tx.sandboxCreditEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.sandboxCreditEntry.create.mock.calls[1][0].data.entryType).toBe('payout_refund');
  });

  it('simulates an approved XTS advertiser deposit and is idempotent', async () => {
    const { service, tx } = makeService();
    tx.sandboxCreditAccount.upsert.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 0n,
    });
    tx.sandboxCreditAccount.update.mockResolvedValue({ balanceMinor: 5_000n });

    const result = await service.simulateDeposit('user-1', {
      amountMinor: 5_000,
      outcome: 'approved',
      idempotencyKey: 'deposit-run-001',
    });

    expect(result).toMatchObject({
      mode: 'sandbox',
      hasCashValue: false,
      status: 'approved',
      balanceMinor: '5000',
    });
    expect(tx.sandboxCreditEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entryType: 'deposit_credit', amountMinor: 5_000n }),
      }),
    );

    tx.sandboxOperation.findUnique.mockResolvedValue({
      id: 'operation-1',
      operationType: 'deposit',
      payloadHash: createHash('sha256')
        .update(
          JSON.stringify({
            operationType: 'deposit',
            payload: { amountMinor: '5000', outcome: 'approved' },
          }),
        )
        .digest('hex'),
      completedAt: new Date(),
      resultBalanceMinor: 5_000n,
      resultId: 'deposit-1',
      resultStatus: 'approved',
    });
    tx.sandboxDepositSimulation.findUnique.mockResolvedValue({
      id: 'deposit-1',
      status: 'approved',
      amountMinor: 5_000n,
      currency: 'XTS',
      providerTxId: 'sandbox_deposit_approved-deposit-1',
      requestedOutcome: 'approved',
    });
    tx.sandboxCreditAccount.upsert.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 5_000n,
    });
    const replay = await service.simulateDeposit('user-1', {
      amountMinor: 5_000,
      outcome: 'approved',
      idempotencyKey: 'deposit-run-001',
    });
    expect(replay).toMatchObject({ duplicate: true, balanceMinor: '5000' });
    expect(tx.sandboxCreditAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_environmentId: { userId: 'user-1', environmentId: 'sandbox-run-1' } },
      }),
    );
    expect(tx.sandboxDepositSimulation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_idempotencyKey: { accountId: 'account-1', idempotencyKey: 'deposit-run-001' },
        },
      }),
    );
  });

  it('records disputed deposits without leaving XTS balance behind', async () => {
    const { service, tx } = makeService();
    tx.sandboxCreditAccount.upsert.mockResolvedValue({
      id: 'account-1',
      environmentId: 'sandbox-run-1',
      currency: 'XTS',
      balanceMinor: 0n,
    });
    tx.sandboxDepositSimulation.create.mockResolvedValue({
      id: 'deposit-2',
      status: 'disputed',
      amountMinor: 5_000n,
      currency: 'XTS',
      providerTxId: 'sandbox_deposit_disputed-deposit-2',
      requestedOutcome: 'disputed',
    });

    const result = await service.simulateDeposit('user-1', {
      amountMinor: 5_000,
      outcome: 'disputed',
      idempotencyKey: 'deposit-run-002',
    });

    expect(result).toMatchObject({ status: 'disputed', balanceMinor: '0' });
    expect(tx.sandboxCreditEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.sandboxCreditEntry.create.mock.calls[1][0].data.entryType).toBe('deposit_chargeback');
  });

  it('reconciles the recorded XTS balance against signed sandbox entries', async () => {
    const { service, prisma } = makeService();
    prisma.sandboxCreditAccount.findMany.mockResolvedValue([
      {
        id: 'account-1',
        userId: 'user-1',
        currency: 'XTS',
        balanceMinor: 8_000n,
      },
    ]);
    prisma.sandboxCreditEntry.findMany.mockResolvedValue([
      { accountId: 'account-1', currency: 'XTS', entryType: 'faucet', amountMinor: 10_000n },
      {
        accountId: 'account-1',
        currency: 'XTS',
        entryType: 'payout_debit',
        amountMinor: 2_000n,
      },
    ]);

    const report = await service.reconcile();

    expect(report).toMatchObject({
      mode: 'sandbox',
      environmentId: 'sandbox-run-1',
      status: 'healthy',
      accountCount: 1,
      totals: {
        mintedMinor: 10_000n,
        burnedMinor: 2_000n,
        recordedBalanceMinor: 8_000n,
        expectedBalanceMinor: 8_000n,
        discrepancyMinor: 0n,
      },
    });
    expect(report.accounts[0]).toMatchObject({
      accountId: 'account-1',
      expectedBalanceMinor: 8_000n,
      discrepancyMinor: 0n,
      status: 'healthy',
    });
  });

  it('flags sandbox balance drift without mutating any records', async () => {
    const { service, prisma } = makeService();
    prisma.sandboxCreditAccount.findMany.mockResolvedValue([
      { id: 'account-1', userId: 'user-1', currency: 'XTS', balanceMinor: 9_000n },
    ]);
    prisma.sandboxCreditEntry.findMany.mockResolvedValue([
      { accountId: 'account-1', currency: 'XTS', entryType: 'faucet', amountMinor: 10_000n },
      { accountId: 'account-1', currency: 'XTS', entryType: 'payout_debit', amountMinor: 2_000n },
    ]);

    const report = await service.reconcile();

    expect(report.status).toBe('unhealthy');
    expect(report.totals.discrepancyMinor).toBe(1_000n);
    expect(prisma.sandboxCreditAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { environmentId: 'sandbox-run-1', currency: 'XTS' } }),
    );
    expect(prisma.sandboxCreditEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { environmentId: 'sandbox-run-1', currency: 'XTS' } }),
    );
  });

  it('requires the configured reset token and clears only the selected sandbox environment', async () => {
    const resetToken = 'sandbox-reset-token-012345678901234567890123';
    const { service, tx, audit } = makeService('sandbox', resetToken);
    tx.sandboxPayoutSimulation.deleteMany.mockResolvedValue({ count: 2 });
    tx.sandboxDepositSimulation.deleteMany.mockResolvedValue({ count: 1 });
    tx.sandboxOperation.deleteMany.mockResolvedValue({ count: 3 });
    tx.sandboxCreditEntry.deleteMany.mockResolvedValue({ count: 5 });
    tx.sandboxCreditAccount.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.reset('sandbox-run-1', resetToken, {
      actorId: 'admin-1',
      actorRole: 'admin',
    });

    expect(result).toMatchObject({
      reset: true,
      environmentId: 'sandbox-run-1',
      deleted: { payouts: 2, deposits: 1, operations: 3, entries: 5, accounts: 1 },
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.sandboxPayoutSimulation.deleteMany).toHaveBeenCalledWith({
      where: { environmentId: 'sandbox-run-1' },
    });
    expect(tx.sandboxDepositSimulation.deleteMany).toHaveBeenCalledBefore(
      tx.sandboxOperation.deleteMany,
    );
    expect(tx.sandboxOperation.deleteMany).toHaveBeenCalledBefore(tx.sandboxCreditEntry.deleteMany);
    expect(tx.sandboxCreditEntry.deleteMany).toHaveBeenCalledBefore(
      tx.sandboxCreditAccount.deleteMany,
    );
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sandbox_reset',
        targetType: 'sandbox_environment',
        targetId: 'sandbox-run-1',
        afterSnap: expect.objectContaining({ environmentId: 'sandbox-run-1' }),
      }),
      tx,
    );
  });

  it('fails closed for reset outside sandbox environments or with a bad token', async () => {
    const resetToken = 'sandbox-reset-token-012345678901234567890123';
    const { service, tx } = makeService('sandbox', resetToken);

    await expect(
      service.reset('sandbox-run-1', 'wrong-token', { actorId: 'admin-1', actorRole: 'admin' }),
    ).rejects.toThrow('Invalid sandbox reset token');
    expect(tx.sandboxCreditAccount.deleteMany).not.toHaveBeenCalled();

    const production = makeService('development', resetToken);
    await expect(
      production.service.reset('sandbox-run-1', resetToken, {
        actorId: 'admin-1',
        actorRole: 'admin',
      }),
    ).rejects.toThrow('only in test or sandbox');
    expect(production.tx.sandboxCreditAccount.deleteMany).not.toHaveBeenCalled();
  });

  it('maps every deposit fault outcome without external or cash effects', async () => {
    const outcomes = [
      'approved',
      'processing',
      'declined',
      'refunded',
      'disputed',
      'timeout',
      'duplicate_callback',
      'delayed_callback',
      'callback_before_response',
      'currency_mismatch',
      'amount_mismatch',
    ] as const;
    const credited = new Set([
      'approved',
      'refunded',
      'disputed',
      'duplicate_callback',
      'delayed_callback',
      'callback_before_response',
    ]);
    const reversed = new Set(['refunded', 'disputed']);
    const { service, tx } = makeService();

    for (const outcome of outcomes) {
      tx.sandboxCreditEntry.create.mockClear();
      tx.sandboxCreditAccount.update.mockClear();
      tx.sandboxCreditAccount.upsert.mockResolvedValue({
        id: 'account-1',
        environmentId: 'sandbox-run-1',
        currency: 'XTS',
        balanceMinor: 0n,
      });
      tx.sandboxCreditAccount.update.mockResolvedValue({ balanceMinor: 5_000n });
      tx.sandboxDepositSimulation.findUnique.mockResolvedValue(null);
      tx.sandboxDepositSimulation.create.mockResolvedValue({
        id: `deposit-${outcome}`,
        status: outcome,
        amountMinor: 5_000n,
        currency: 'XTS',
        providerTxId: `sandbox_deposit_${outcome}`,
        requestedOutcome: outcome,
      });

      const result = await service.simulateDeposit('user-1', {
        amountMinor: 5_000,
        outcome,
        idempotencyKey: `deposit-${outcome}`,
      });

      expect(result).toMatchObject({
        status: outcome,
        mode: 'sandbox',
        hasCashValue: false,
        currency: 'XTS',
        balanceMinor: credited.has(outcome) && !reversed.has(outcome) ? '5000' : '0',
      });
      expect(tx.sandboxCreditEntry.create).toHaveBeenCalledTimes(
        credited.has(outcome) ? (reversed.has(outcome) ? 2 : 1) : 0,
      );
      expect(tx.sandboxCreditAccount.update).toHaveBeenCalledTimes(
        credited.has(outcome) && !reversed.has(outcome) ? 1 : 0,
      );
    }
  });
});
