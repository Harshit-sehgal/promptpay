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
    referralReward: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    platformLedger: { create: vi.fn().mockResolvedValue({}) },
    earningsLedger: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
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

describe('ReferralService.reverseReferralReward (Round 36) — fraud/ban clawback', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ReferralService;

  beforeEach(() => {
    prisma = makePrisma();
    const ledger = { audit: { log: vi.fn().mockResolvedValue(undefined) } } as any;
    const config = { get: vi.fn().mockReturnValue('http://localhost:3000') } as any;
    service = new ReferralService(prisma as any, ledger, config);
    prisma.$transaction = vi.fn(async (cb: any) => cb(prisma));
  });

  it('flips referralReward + earningsLedger credit to reversed and writes a compensating platform reversal', async () => {
    prisma.referralReward.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.earningsLedger.findUnique.mockResolvedValueOnce({
      id: 'earn-1',
      amountMinor: BigInt(REFERRAL.REWARD_AMOUNT_MINOR),
      currency: REFERRAL.CURRENCY,
      status: 'confirmed',
    });

    const result = await service.reverseReferralReward('ref-1', 'Referrer banned for fraud');

    expect(result).toEqual({ reversed: 1, paidSkipped: 0 });

    // 1. referralReward flipped to `reversed` (CAS on status confirmed).
    expect(prisma.referralReward.updateMany).toHaveBeenCalledWith({
      where: { referralId: 'ref-1', status: 'confirmed' },
      data: { status: 'reversed' },
    });
    // 2. earningsLedger credit flipped to `reversed` (heldByFlagId cleared).
    expect(prisma.earningsLedger.update).toHaveBeenCalledWith({
      where: { id: 'earn-1' },
      data: expect.objectContaining({
        status: 'reversed',
        heldByFlagId: null,
      }),
    });
    // 3. Compensating platformLedger reversal in the referral_bonus bucket.
    expect(prisma.platformLedger.create).toHaveBeenCalledTimes(1);
    const platArg = prisma.platformLedger.create.mock.calls[0][0].data;
    expect(platArg).toMatchObject({
      entryType: 'reversal',
      bucket: 'referral_bonus',
      currency: REFERRAL.CURRENCY,
      idempotencyKey: 'ref-rew-ref-1-rev',
    });
    expect(platArg.amountMinor).toBe(BigInt(REFERRAL.REWARD_AMOUNT_MINOR));
  });

  it('is idempotent when the reward was already reversed (updateMany count 0)', async () => {
    prisma.referralReward.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.reverseReferralReward('ref-1', 'duplicate reversal');

    expect(result).toEqual({ reversed: 0, paidSkipped: 0 });
    // No earnings row should be touched, no platform reversal written.
    expect(prisma.earningsLedger.update).not.toHaveBeenCalled();
    expect(prisma.platformLedger.create).not.toHaveBeenCalled();
  });

  it('surfaces paidSkipped when the earnings has already been paid out (cannot claw back)', async () => {
    prisma.referralReward.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.earningsLedger.findUnique.mockResolvedValueOnce({
      id: 'earn-1',
      amountMinor: BigInt(REFERRAL.REWARD_AMOUNT_MINOR),
      currency: REFERRAL.CURRENCY,
      status: 'paid',
    });

    const result = await service.reverseReferralReward('ref-1', 'late ban');

    expect(result).toEqual({ reversed: 1, paidSkipped: 1 });
    // The paid earnings row must NOT be flipped — that money already left the
    // building and must be recovered via recovery-debt, not a ledger reversal.
    expect(prisma.earningsLedger.update).not.toHaveBeenCalled();
  });

  it('reverseAllReferralRewardsForUser iterates all confirmed rewards for a referrer', async () => {
    prisma.referralReward.findMany.mockResolvedValueOnce([
      { referralId: 'ref-a' },
      { referralId: 'ref-b' },
    ]);
    prisma.referralReward.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.earningsLedger.findUnique.mockResolvedValue({
      id: 'earn-x',
      amountMinor: BigInt(REFERRAL.REWARD_AMOUNT_MINOR),
      currency: REFERRAL.CURRENCY,
      status: 'confirmed',
    });

    const result = await service.reverseAllReferralRewardsForUser(
      'referrer-1',
      'Banned: confirmed fraud ring',
    );

    expect(result).toEqual({ reversed: 2, paidSkipped: 0 });
    expect(prisma.referralReward.findMany).toHaveBeenCalledWith({
      where: { userId: 'referrer-1', status: 'confirmed' },
      select: { referralId: true },
    });
  });
});
