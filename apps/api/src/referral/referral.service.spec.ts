import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REFERRAL } from '@waitlayer/shared';

import { ReferralService } from './referral.service';

function makePrisma() {
  return {
    referral: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    referralReward: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({}) },
    platformLedger: { create: vi.fn().mockResolvedValue({}) },
    earningsLedger: { create: vi.fn().mockResolvedValue({}) },
    payoutRequest: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe('ReferralService.processReferralRewards payoutable earnings (A-041)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { log: ReturnType<typeof vi.fn> };
  let service: ReferralService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const ledger = { audit } as any;
    const config = { get: vi.fn().mockReturnValue('http://localhost:3000') } as any;
    service = new ReferralService(prisma as any, ledger, config);

    prisma.referral.findFirst.mockResolvedValue({
      id: 'ref-1',
      referrerId: 'referrer-1',
      referredId: 'referred-1',
      status: 'pending',
      rewards: [],
      referrer: { status: 'active' },
    });
    prisma.payoutRequest.count.mockResolvedValue(1);
    prisma.payoutRequest.findFirst.mockResolvedValue({
      allocations: [{ amountMinor: BigInt(REFERRAL.FIRST_PAYOUT_THRESHOLD_MINOR + 100) }],
    });
    prisma.$transaction = vi.fn(async (cb: any) => cb(prisma));
  });

  it('writes a payoutable earningsLedger credit (idempotent per referral)', async () => {
    const result = await service.processReferralRewards('referred-1');

    expect(result).not.toBeNull();
    expect(prisma.earningsLedger.create).toHaveBeenCalledTimes(1);
    const earningsArg = prisma.earningsLedger.create.mock.calls[0][0].data;
    expect(earningsArg).toMatchObject({
      userId: 'referrer-1',
      entryType: 'credit',
      status: 'confirmed',
      amountMinor: BigInt(REFERRAL.REWARD_AMOUNT_MINOR),
      currency: REFERRAL.CURRENCY,
      idempotencyKey: `ref-rew-earn-ref-1`,
    });

    // Audit log fired exactly once for the rewarded referral.
    expect(audit.log).toHaveBeenCalledTimes(1);
    const auditArg = audit.log.mock.calls[0][0];
    expect(auditArg).toMatchObject({
      action: 'process_referral_rewards',
      targetType: 'referral',
      targetId: 'ref-1',
    });

    // Second call must be a no-op (reward already exists) — no second earnings row.
    prisma.referral.findFirst.mockResolvedValueOnce({
      id: 'ref-1',
      referrerId: 'referrer-1',
      referredId: 'referred-1',
      status: 'rewarded',
      rewards: [{ status: 'confirmed' }],
      referrer: { status: 'active' },
    });
    const second = await service.processReferralRewards('referred-1');
    expect(second).toBeNull();
    expect(prisma.earningsLedger.create).toHaveBeenCalledTimes(1);
    // Idempotent no-op must NOT emit a second audit row.
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
