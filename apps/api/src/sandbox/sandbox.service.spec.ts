import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../config/prisma.service';
import { SandboxService } from './sandbox.service';

function makeService(environmentKind = 'sandbox') {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    sandboxCreditEntry: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: null } }),
      create: vi.fn().mockResolvedValue({ amountMinor: 10_000n }),
    },
    sandboxCreditAccount: {
      findUnique: vi.fn(),
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
    sandboxCreditAccount: { findUnique: vi.fn() },
    sandboxPayoutSimulation: { findMany: vi.fn() },
    sandboxDepositSimulation: { findMany: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const config = {
    get: vi.fn((key: string, fallback: string) =>
      key === 'WAITLAYER_ENVIRONMENT_KIND'
        ? environmentKind
        : fallback === 'local'
          ? 'sandbox-run-1'
          : fallback,
    ),
  };
  return {
    service: new SandboxService(prisma as unknown as PrismaService, config as never),
    prisma,
    tx,
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
    tx.sandboxCreditEntry.findUnique.mockResolvedValue({
      amountMinor: 10_000n,
      account: { balanceMinor: 10_000n },
    });

    const result = await service.claimFaucet('user-1', 'faucet-run-001');

    expect(result).toMatchObject({ balanceMinor: '10000', grantedMinor: 10000, duplicate: true });
    expect(tx.sandboxCreditEntry.create).not.toHaveBeenCalled();
    expect(tx.sandboxCreditAccount.update).not.toHaveBeenCalled();
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

    tx.sandboxDepositSimulation.findUnique.mockResolvedValue({
      id: 'deposit-1',
      status: 'approved',
      amountMinor: 5_000n,
      currency: 'XTS',
      providerTxId: 'sandbox_deposit_approved-deposit-1',
      account: { balanceMinor: 5_000n },
    });
    const replay = await service.simulateDeposit('user-1', {
      amountMinor: 5_000,
      outcome: 'approved',
      idempotencyKey: 'deposit-run-001',
    });
    expect(replay).toMatchObject({ duplicate: true, balanceMinor: '5000' });
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
