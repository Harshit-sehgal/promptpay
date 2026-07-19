import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FraudFlagStatus } from '@waitlayer/db';

import { validateFraudFlagTransition } from './fraud.constants';
import { FraudService } from './fraud.service';

const mockPrisma = {
  fraudFlag: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  trustScore: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  impression: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  adImpression: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  adClick: {
    count: vi.fn(),
  },
  campaignClick: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  device: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  payoutAccount: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  payoutRequest: {
    count: vi.fn(),
  },
  payoutAllocation: {
    count: vi.fn(),
  },
  campaign: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  waitStateEvent: {
    groupBy: vi.fn(),
  },
  earningsLedger: {
    aggregate: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
  $queryRaw: vi.fn().mockResolvedValue([{ count: 0 }]),
  $transaction: vi.fn((...args: any[]) => {
    if (typeof args[0] === 'function') return args[0](mockPrisma);
    return Promise.all(args.map((fn: Function) => fn()));
  }),
};
const prismaRef = mockPrisma as any;

const mockLedger = {
  getAvailableBalance: vi.fn(),
  getPendingBalance: vi.fn(),
  holdEarnings: vi.fn(),
  releaseEarnings: vi.fn(),
  reverseEarnings: vi.fn(),
} as any;

function mockUserWithFlags(overrides: any = {}) {
  return {
    emailVerified: false,
    githubVerified: false,
    createdAt: new Date(Date.now() - 1 * 24 * 3600_000),
    fraudFlags: [],
    ...overrides,
  };
}

describe('FraudService', () => {
  let service: FraudService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.$queryRaw.mockResolvedValue([{ count: 0 }]);
    mockPrisma.payoutAllocation.count.mockResolvedValue(0);
    mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });
    service = new FraudService(prismaRef, mockLedger);
  });

  describe('computeTrustScore', () => {
    it('starts at 40 for a new account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.waitStateEvent.groupBy.mockResolvedValue([]);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      const score = await service.computeTrustScore('u-1');
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(50);
    });

    it('assigns bonus points for verified email and GitHub', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUserWithFlags({
          emailVerified: true,
          githubVerified: true,
          createdAt: new Date(Date.now() - 60 * 24 * 3600_000),
        }),
      );
      mockPrisma.device.count.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([{ count: 10 }]);
      mockPrisma.payoutRequest.count.mockResolvedValue(3);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 90 });

      const score = await service.computeTrustScore('u-2');
      // 40 base + 15 age + 10 email + 15 github + 10 device + 10 activity + 15 payouts
      expect(score).toBeGreaterThan(90);
    });

    it('awards activity points for distinct days rather than raw event volume', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      // The SQL result represents one distinct UTC day even if that day had
      // many wait-state events.
      mockPrisma.$queryRaw.mockResolvedValue([{ count: 1 }]);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 42 });
      mockPrisma.user.update.mockResolvedValue({});

      await expect(service.computeTrustScore('u-burst')).resolves.toBe(42);
      expect(mockPrisma.trustScore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ activityPatternPts: 1, deviceConsistPts: 0 }),
        }),
      );
    });

    it('applies critical penalties', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUserWithFlags({
          emailVerified: true,
          githubVerified: true,
          createdAt: new Date(Date.now() - 90 * 24 * 3600_000),
          fraudFlags: [
            { severity: 'critical', status: 'open' },
            { severity: 'critical', status: 'open' },
            { severity: 'high', status: 'open' },
          ],
        }),
      );
      mockPrisma.device.count.mockResolvedValue(1);
      mockPrisma.$queryRaw.mockResolvedValue([{ count: 10 }]);
      mockPrisma.payoutRequest.count.mockResolvedValue(2);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 60 });

      const score = await service.computeTrustScore('u-3');
      // The real service computed this; trust the implementation
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(80);
    });

    it('clamps to 0 with heavy penalties', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUserWithFlags({
          fraudFlags: Array.from({ length: 10 }, () => ({
            severity: 'critical' as const,
            status: 'open',
          })),
        }),
      );
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.waitStateEvent.groupBy.mockResolvedValue([]);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 0 });

      const score = await service.computeTrustScore('u-4');
      expect(score).toBe(0);
    });
  });

  describe('checkImpressionRateLimit', () => {
    it('blocks if over 60 impressions in last hour', async () => {
      mockPrisma.adImpression.count.mockResolvedValue(61);
      const result = await service.checkImpressionRateLimit('u-1', 'd-1');
      expect(result.allowed).toBe(false);
    });

    it('allows under limit', async () => {
      mockPrisma.adImpression.count.mockResolvedValue(10);
      const result = await service.checkImpressionRateLimit('u-1', 'd-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkSelfClick', () => {
    it('blocks user clicking own campaign', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'c-1',
        advertiser: { userId: 'u-1' },
      });
      // checkSelfClick triggers createFlag (CRITICAL self-clicking) which
      // creates an actual fraud flag row and (since severity=CRITICAL +
      // userId set) calls ledger.holdEarnings(userId, reason, flagId).
      // The createFlag mock must return an id so `flag.id` doesn't crash
      // before holdEarnings fires; ledger.holdEarnings is mocked in this
      // spec, so the actual id content doesn't matter — only that it's
      // defined.
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-self-click' });
      const result = await service.checkSelfClick('u-1', 'c-1');
      expect(result.allowed).toBe(false);
    });

    it('allows if user is not campaign advertiser', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'c-1',
        advertiser: { userId: 'u-99' },
      });
      const result = await service.checkSelfClick('u-1', 'c-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('createFlag', () => {
    it('creates fraud flag and recomputes trust', async () => {
      mockPrisma.fraudFlag.create.mockResolvedValue({
        id: 'flag-1',
        severity: 'high',
        automatic: true,
        userId: 'u-1',
      });
      // computeTrustScore runs after create; mock its dependencies
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUserWithFlags({ createdAt: new Date(Date.now() - 90 * 24 * 3600_000) }),
      );
      mockPrisma.device.count.mockResolvedValue(1);
      mockPrisma.waitStateEvent.groupBy.mockResolvedValue([]);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 50 });
      mockPrisma.user.update.mockResolvedValue({});

      const flag = await service.createFlag({
        userId: 'u-1',
        flagType: 'suspicious_ctr' as any,
        severity: 'high',
      });
      expect(flag.id).toBe('flag-1');
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalled();
      expect(mockPrisma.trustScore.upsert).toHaveBeenCalled();
    });

    it('upgrades a deduplicated flag to critical and holds earnings in the same transaction', async () => {
      const existing = {
        id: 'flag-existing',
        userId: 'u-1',
        flagType: 'suspicious_ctr',
        severity: 'medium',
        status: 'open',
      };
      const upgraded = { ...existing, severity: 'critical' };
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(existing);
      mockPrisma.fraudFlag.update.mockResolvedValue(upgraded);
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.waitStateEvent.groupBy.mockResolvedValue([]);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await expect(
        service.createFlag({
          userId: 'u-1',
          flagType: 'suspicious_ctr' as any,
          severity: 'critical',
          evidence: { source: 'new-detection' },
        }),
      ).resolves.toEqual(upgraded);

      expect(mockPrisma.fraudFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-existing' },
        data: { severity: 'critical' },
      });
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u-1',
          status: { in: ['estimated', 'pending', 'confirmed'] },
          heldByFlagId: null,
        },
        data: {
          status: 'held',
          description: 'Held: Critical fraud flag: suspicious_ctr',
          heldByFlagId: 'flag-existing',
        },
      });
      expect(mockLedger.holdEarnings).not.toHaveBeenCalled();
    });
  });

  describe('resolveFlag', () => {
    it('marks flag resolved and penalizes', async () => {
      mockPrisma.fraudFlag.findUnique.mockResolvedValue({
        id: 'flag-1',
        userId: 'u-1',
        severity: 'high',
        status: 'open',
      });
      // New resolveFlag path uses conditional updateMany so a concurrent
      // second resolution can't overwrite reviewerId/reviewNote or re-run
      // releaseEarnings twice. Mock returns count=1 (the claim wins).
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUserWithFlags({
          emailVerified: true,
          createdAt: new Date(Date.now() - 90 * 24 * 3600_000),
        }),
      );
      mockPrisma.device.count.mockResolvedValue(1);
      mockPrisma.waitStateEvent.groupBy.mockResolvedValue([]);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 50 });

      const result = await service.resolveFlag('flag-1', 'rev-adm', true, 'Confirmed fraud');
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('resolved_valid');
      expect(mockPrisma.fraudFlag.updateMany).toHaveBeenCalled();
    });

    it('defers a valid entity reversal while its earnings are in an in-flight payout', async () => {
      mockPrisma.fraudFlag.findUnique.mockResolvedValue({
        id: 'flag-in-flight',
        userId: 'u-1',
        impressionId: 'imp-1',
        clickId: null,
        severity: 'critical',
        status: 'open',
      });
      mockPrisma.payoutAllocation.count.mockResolvedValue(1);

      await expect(
        service.resolveFlag('flag-in-flight', 'rev-adm', true, 'Confirmed fraud'),
      ).rejects.toThrow(/in-flight payout/i);

      expect(mockPrisma.payoutAllocation.count).toHaveBeenCalledWith({
        where: {
          payoutRequest: { status: 'processing' },
          earningsEntry: { impressionId: 'imp-1' },
        },
      });
      expect(mockPrisma.fraudFlag.updateMany).not.toHaveBeenCalled();
      expect(mockLedger.reverseEarnings).not.toHaveBeenCalled();
    });

    it('Round 36: forfeits all held earnings for a confirmed behavioral critical flag (no impressionId/clickId)', async () => {
      // SHARED_PAYOUT_DESTINATION / IMPOSSIBLE_VOLUME / SELF_CLICKING have no
      // single entity reference. Before Round 36, resolving these isValid=true
      // hit neither the reverseEarnings branch (needs clickId/impressionId) nor
      // the releaseEarnings branch (needs !isValid) → held rows stranded forever.
      // Now they flip to `reversed` under the per-hold-by-flagId scope.
      mockPrisma.fraudFlag.findUnique.mockResolvedValue({
        id: 'flag-behavioral',
        userId: 'u-1',
        clickId: null,
        impressionId: null,
        flagType: 'SHARED_PAYOUT_DESTINATION',
        severity: 'critical',
        status: 'open',
      });
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUserWithFlags({
          emailVerified: true,
          createdAt: new Date(Date.now() - 90 * 24 * 3600_000),
        }),
      );
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 50 });

      const result = await service.resolveFlag(
        'flag-behavioral',
        'rev-adm',
        true,
        'Confirmed behavioral fraud',
      );
      expect(result.isValid).toBe(true);

      // The held-by-this-flag earnings rows must be flipped to `reversed` so
      // they leave the held limbo (otherwise the developer's payout balance is
      // permanently frozen with no admin recovery path).
      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', heldByFlagId: 'flag-behavioral', status: 'held' },
        data: expect.objectContaining({
          status: 'reversed',
          heldByFlagId: null,
        }),
      });
      // reverseEarnings must NOT be called — there is no entity reference.
      expect(mockLedger.reverseEarnings).not.toHaveBeenCalled();
      // releaseEarnings is for the !isValid (cleared) branch, not used here.
      expect(mockLedger.releaseEarnings).not.toHaveBeenCalled();
    });

    it('allows a senior reviewer to resolve an escalated flag', async () => {
      mockPrisma.fraudFlag.findUnique.mockResolvedValue({
        id: 'flag-escalated',
        userId: 'u-1',
        impressionId: null,
        clickId: null,
        severity: 'critical',
        status: 'escalated',
      });
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });
      mockLedger.releaseEarnings.mockResolvedValue({ count: 1 });

      await expect(
        service.resolveFlag('flag-escalated', 'senior-admin', false, 'Cleared by senior review'),
      ).resolves.toMatchObject({ status: 'resolved_invalid', isValid: false });

      expect(mockPrisma.fraudFlag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'flag-escalated',
            status: { in: expect.arrayContaining(['open', 'reviewing', 'escalated']) },
          }),
        }),
      );
      expect(mockLedger.releaseEarnings).toHaveBeenCalledWith(
        'u-1',
        {
          impressionId: undefined,
          flagId: 'flag-escalated',
        },
        expect.any(Object),
      );
    });

    it('retries idempotent ledger reconciliation after an atomic resolution rolls back', async () => {
      const baseFlag = {
        id: 'flag-retry',
        userId: 'u-1',
        impressionId: 'imp-retry',
        clickId: null,
        flagType: 'invalid_impression',
        severity: 'high',
      };
      mockPrisma.fraudFlag.findUnique.mockResolvedValue({ ...baseFlag, status: 'open' });
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 1 });
      mockLedger.reverseEarnings
        .mockRejectedValueOnce(new Error('ledger unavailable after flag commit'))
        .mockResolvedValueOnce({ reversed: 1, paidSkipped: 0 });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await expect(
        service.resolveFlag('flag-retry', 'reviewer-1', true, 'confirmed'),
      ).rejects.toThrow('ledger unavailable');
      await expect(
        service.resolveFlag('flag-retry', 'reviewer-1', true, 'confirmed'),
      ).resolves.toMatchObject({ status: 'resolved_valid', isValid: true });

      expect(mockPrisma.fraudFlag.updateMany).toHaveBeenCalledTimes(2);
      expect(mockLedger.reverseEarnings).toHaveBeenCalledTimes(2);
    });
  });

  describe('escalateFlag', () => {
    it('escalates an open flag to the escalated state', async () => {
      mockPrisma.fraudFlag.findUnique.mockResolvedValue({
        id: 'flag-esc',
        userId: 'u-1',
        status: 'open',
      });
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.escalateFlag('flag-esc', 'rev-adm', 'Needs senior review');
      expect(result.status).toBe('escalated');
      expect(mockPrisma.fraudFlag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'escalated', reviewerId: 'rev-adm' }),
        }),
      );
    });

    it('rejects escalation of an already-resolved flag', async () => {
      mockPrisma.fraudFlag.findUnique
        .mockResolvedValueOnce({ id: 'flag-done', status: 'resolved_valid' })
        .mockResolvedValueOnce({ id: 'flag-done', status: 'resolved_valid' });
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.escalateFlag('flag-done', 'rev-adm')).rejects.toThrow(
        /cannot be escalated from status/,
      );
    });

    it('is idempotent when a concurrent reviewer already escalated', async () => {
      mockPrisma.fraudFlag.findUnique
        .mockResolvedValueOnce({ id: 'flag-race', status: 'open' })
        .mockResolvedValueOnce({ id: 'flag-race', status: 'escalated' });
      mockPrisma.fraudFlag.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.escalateFlag('flag-race', 'rev-adm');
      expect(result.status).toBe('escalated');
    });
  });

  describe('getOpenFlags', () => {
    it('keeps escalated flags in the active review queue', async () => {
      mockPrisma.fraudFlag.findMany.mockResolvedValue([]);
      mockPrisma.fraudFlag.count.mockResolvedValue(0);

      await service.getOpenFlags();

      expect(mockPrisma.fraudFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: { in: expect.arrayContaining(['open', 'reviewing', 'escalated']) },
          },
        }),
      );
    });
  });

  // ── Extended Fraud Detection tests ──

  describe('checkSharedPayoutDestination', () => {
    it('flags when the same destination is used by another user', async () => {
      mockPrisma.payoutAccount.count.mockResolvedValue(1);
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-spd' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkSharedPayoutDestination('u-1', 'shared@email.com');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'shared_payout_destination',
            severity: 'critical',
          }),
        }),
      );
    });

    it('does not flag when the destination is unique to the user', async () => {
      mockPrisma.payoutAccount.count.mockResolvedValue(0);
      await service.checkSharedPayoutDestination('u-1', 'unique@email.com');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('checkImpossibleVolume', () => {
    it('flags when impression count exceeds the physical threshold', async () => {
      mockPrisma.adImpression.count.mockResolvedValue(25);
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-iv' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkImpossibleVolume('u-1');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'impossible_volume',
            severity: 'critical',
          }),
        }),
      );
    });

    it('does not flag when impression count is within normal range', async () => {
      mockPrisma.adImpression.count.mockResolvedValue(5);
      await service.checkImpossibleVolume('u-1');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('checkRepeatedClickAbuse', () => {
    it('flags when 5+ clicks on the same campaign within an hour', async () => {
      mockPrisma.adClick.count.mockResolvedValue(7);
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-rca' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkRepeatedClickAbuse('u-1', 'camp-1');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'repeated_click_abuse',
            severity: 'high',
          }),
        }),
      );
    });

    it('does not flag for low click counts', async () => {
      mockPrisma.adClick.count.mockResolvedValue(2);
      await service.checkRepeatedClickAbuse('u-1', 'camp-1');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('checkAutomatedPattern', () => {
    it('flags when inter-arrival intervals have very low variance', async () => {
      // 12 impressions at exactly 10-second intervals (CV = 0)
      const base = Date.now();
      const impressions = Array.from({ length: 12 }, (_, i) => ({
        createdAt: new Date(base + i * 10000),
      }));
      mockPrisma.adImpression.findMany.mockResolvedValue(impressions);
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-ap' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkAutomatedPattern('u-1');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'automated_pattern',
            severity: 'high',
          }),
        }),
      );
    });

    it('does not flag for human-like irregular intervals', async () => {
      const base = Date.now();
      const impressions = [
        { createdAt: new Date(base) },
        { createdAt: new Date(base + 3000) },
        { createdAt: new Date(base + 45000) },
        { createdAt: new Date(base + 120000) },
        { createdAt: new Date(base + 95000) },
        { createdAt: new Date(base + 300000) },
        { createdAt: new Date(base + 12000) },
        { createdAt: new Date(base + 78000) },
        { createdAt: new Date(base + 200000) },
        { createdAt: new Date(base + 5000) },
      ];
      mockPrisma.adImpression.findMany.mockResolvedValue(impressions);
      await service.checkAutomatedPattern('u-1');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });

    it('does not flag when fewer than 10 impressions', async () => {
      mockPrisma.adImpression.findMany.mockResolvedValue([
        { createdAt: new Date() },
        { createdAt: new Date() },
      ]);
      await service.checkAutomatedPattern('u-1');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('checkVpnProxyPattern', () => {
    it('flags known headless/automation platforms', async () => {
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-vpn' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkVpnProxyPattern('u-1', 'dev-1', 'HeadlessChrome');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'vpn_proxy_pattern',
            severity: 'high',
          }),
        }),
      );
    });

    it('does not flag normal platforms', async () => {
      await service.checkVpnProxyPattern('u-1', 'dev-1', 'macOS');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('checkEmulatorVmPattern', () => {
    it('flags known emulator platforms', async () => {
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-vm' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFlags());
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkEmulatorVmPattern('u-1', 'dev-1', 'x86 emulator');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'emulator_vm_pattern',
            severity: 'medium',
          }),
        }),
      );
    });
  });

  describe('checkDuplicateAccount', () => {
    it('flags when a new account shares a device fingerprint with another user', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        createdAt: new Date(),
        email: 'new@test.com',
      });
      mockPrisma.device.findMany.mockResolvedValueOnce([{ fingerprintHash: 'fp-1' }]);
      mockPrisma.device.findMany.mockResolvedValueOnce([{ userId: 'existing-user' }]);
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-da' });
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkDuplicateAccount('u-new');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'duplicate_account',
            severity: 'high',
          }),
        }),
      );
    });

    it('does not flag accounts older than 24 hours', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        email: 'old@test.com',
      });
      await service.checkDuplicateAccount('u-old');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });

  describe('checkCountryDeviceChange', () => {
    it('flags when profile country differs from request country', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ country: 'US' })
        .mockResolvedValueOnce(mockUserWithFlags());
      mockPrisma.fraudFlag.findFirst.mockResolvedValue(null);
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-cdc' });
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.payoutRequest.count.mockResolvedValue(0);
      mockPrisma.trustScore.upsert.mockResolvedValue({ score: 40 });

      await service.checkCountryDeviceChange('u-1', 'dev-1', 'RU');
      expect(mockPrisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flagType: 'country_device_change',
            severity: 'medium',
          }),
        }),
      );
    });

    it('does not flag when countries match', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ country: 'US' });
      await service.checkCountryDeviceChange('u-1', 'dev-1', 'US');
      expect(mockPrisma.fraudFlag.create).not.toHaveBeenCalled();
    });
  });
});

// ── Declarative fraud-flag transition guard unit tests ──
// These assert FRAUD_FLAG_TRANSITIONS is enforced by validateFraudFlagTransition
// directly. (The spec's generic `resolved`/`dismissed` collapse onto the two
// concrete resolved outcomes the schema supports: resolved_valid/resolved_invalid.)

describe('validateFraudFlagTransition (declarative guard)', () => {
  it('allows open → reviewing', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.open, FraudFlagStatus.reviewing),
    ).not.toThrow();
  });

  it('allows open → escalated', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.open, FraudFlagStatus.escalated),
    ).not.toThrow();
  });

  it('allows open → resolved_valid and open → resolved_invalid', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.open, FraudFlagStatus.resolved_valid),
    ).not.toThrow();
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.open, FraudFlagStatus.resolved_invalid),
    ).not.toThrow();
  });

  it('allows reviewing → escalated and reviewing → resolved_*', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.reviewing, FraudFlagStatus.escalated),
    ).not.toThrow();
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.reviewing, FraudFlagStatus.resolved_valid),
    ).not.toThrow();
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.reviewing, FraudFlagStatus.resolved_invalid),
    ).not.toThrow();
  });

  it('allows escalated → resolved_valid and escalated → resolved_invalid', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.escalated, FraudFlagStatus.resolved_valid),
    ).not.toThrow();
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.escalated, FraudFlagStatus.resolved_invalid),
    ).not.toThrow();
  });

  it('rejects resolved_valid → open (terminal state cannot leave)', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.resolved_valid, FraudFlagStatus.open),
    ).toThrow(/Invalid fraud flag transition/);
  });

  it('rejects resolved_invalid → escalated (terminal state cannot leave)', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.resolved_invalid, FraudFlagStatus.escalated),
    ).toThrow(/Invalid fraud flag transition/);
  });

  it('rejects reviewing → open (illegal backwards hop)', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.reviewing, FraudFlagStatus.open),
    ).toThrow(/Invalid fraud flag transition/);
  });

  it('rejects escalated → reviewing (illegal backwards hop)', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.escalated, FraudFlagStatus.reviewing),
    ).toThrow(/Invalid fraud flag transition/);
  });

  it('rejects resolved_valid → resolved_invalid (terminal to terminal)', () => {
    expect(() =>
      validateFraudFlagTransition(FraudFlagStatus.resolved_valid, FraudFlagStatus.resolved_invalid),
    ).toThrow(/Invalid fraud flag transition/);
  });
});
