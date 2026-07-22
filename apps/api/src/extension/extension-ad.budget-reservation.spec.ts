import { describe, expect, it, vi } from 'vitest';

import { BidType } from '@waitlayer/db';

import { makeTestEvidence } from './evidence.test-helper';
import { ExtensionService } from './extension.service';
import { BILLABLE_WAIT_SIGNALS } from './test/wait-fixtures';

/**
 * Unit tests for the atomic campaign budget reservation feature.
 *
 * requestAd() reserves budget for CPM campaigns in the impression transaction.
 * recordQualifiedImpression() converts the reservation to spent budget when
 * the impression is billable, or releases it when the impression is invalidated.
 * CPC campaigns never reserve budget at impression time; clicks are charged
 * directly at click time.
 */

function makePrisma() {
  const prisma: any = {
    adImpression: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      update: vi.fn(async (args: any) => args.data),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    waitStateEvent: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ws-1',
        signals: BILLABLE_WAIT_SIGNALS,
        evidence: makeTestEvidence(
          [
            { type: 'active_task', adapterId: 'vscode.task' },
            { type: 'command_execution', adapterId: 'vscode.terminal' },
          ],
          { waitStateId: 'ws-1', sessionId: 's-1' },
        ),
        detectorVersion: '1.0.0',
      }),
    },
    trustScore: { findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    // Each billable fixture represents a provider-verified wait session; tests
    // that exercise invalidation fail earlier than this lookup.
    waitAttestation: { findFirst: vi.fn().mockResolvedValue({ id: 'attestation-1' }) },
    $executeRaw: vi.fn(async () => 1),
    $executeRawUnsafe: vi.fn(async () => 1),
  };

  // Serialize transaction callbacks like the concurrency spec.
  let txChain: Promise<unknown> = Promise.resolve();
  prisma.$transaction = vi.fn(async (cb: (tx: any) => Promise<any>) => {
    const tx = {
      advertiserLedger: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { entryType: 'credit', status: 'confirmed', _sum: { amountMinor: 1000n } },
          ]),
        create: vi.fn(async (args: any) => args.data),
      },
      earningsLedger: { create: vi.fn(async (args: any) => args.data) },
      platformLedger: { create: vi.fn(async (args: any) => args.data) },
      adImpression: { updateMany: prisma.adImpression.updateMany },
      adCreative: { count: vi.fn().mockResolvedValue(0) },
      $executeRaw: prisma.$executeRaw,
      $executeRawUnsafe: prisma.$executeRawUnsafe,
    };
    const run = txChain.then(() => cb(tx));
    txChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });

  return prisma;
}

function makeImpression(
  overrides: {
    bidType?: 'cpm' | 'cpc';
    bidAmountMinor?: number;
    qualifiedAt?: Date | null;
    renderedAt?: Date;
  } = {},
) {
  return {
    id: 'imp-1',
    userId: 'user-1',
    deviceId: 'dev-1',
    waitStateId: 'ws-1',
    attestationSessionId: 'attestation-session-1',
    sessionId: 's-1',
    campaignId: 'camp-1',
    impressionTokenHash: 'hash-1',
    renderedAt: overrides.renderedAt ?? new Date(Date.now() - 10_000),
    qualifiedAt: overrides.qualifiedAt ?? null,
    campaign: {
      id: 'camp-1',
      bidAmountMinor: overrides.bidAmountMinor ?? 100,
      currency: 'USD',
      advertiserId: 'adv-1',
      bidType: overrides.bidType ?? 'cpm',
    },
    user: { status: 'active' },
  };
}

function claimArgs(overrides: Partial<Parameters<ExtensionService['claimImpression']>[0]> = {}) {
  return {
    userId: 'user-1',
    deviceId: 'dev-1',
    sessionId: 'session-1',
    waitStateId: 'wait-1',
    idempotencyKey: 'idem-1',
    campaignId: 'camp-1',
    creativeId: 'creative-1',
    impressionTokenHash: 'token-hash-1',
    bidType: BidType.cpm,
    bidAmountMinor: 100n,
    maxPerHour: 6,
    oneHourAgo: new Date(Date.now() - 60 * 60 * 1000),
    ...overrides,
  };
}

function makeClaimPrisma(
  options: {
    existing?: { id: string } | null;
    recentCount?: number;
    reserveResult?: number;
    createError?: Error;
  } = {},
) {
  const events: string[] = [];
  const rootExecuteRaw = vi.fn(async () => 1);
  const txExecuteRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join(' ');
    if (sql.includes('pg_advisory_xact_lock')) {
      events.push('lock');
      return 1;
    }
    events.push('reserve');
    return options.reserveResult ?? 1;
  });
  const adImpression = {
    findFirst: vi.fn(async () => {
      events.push('duplicate_check');
      return options.existing ?? null;
    }),
    count: vi.fn(async () => {
      events.push('cap_check');
      return options.recentCount ?? 0;
    }),
    create: vi.fn(async () => {
      events.push('insert');
      if (options.createError) throw options.createError;
      return { id: 'imp-created' };
    }),
  };
  const tx = { adImpression, $executeRaw: txExecuteRaw };
  const prisma: any = {
    $executeRaw: rootExecuteRaw,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, adImpression, events, rootExecuteRaw, txExecuteRaw };
}

describe('ExtensionAdTrait atomic reservation claim', () => {
  it('checks duplicate and cap, then reserves and inserts in one transaction', async () => {
    const { prisma, events, rootExecuteRaw, txExecuteRaw } = makeClaimPrisma();
    const service = new ExtensionService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
        isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );

    const result = await service.claimImpression(claimArgs());

    expect(result).toEqual({ status: 'claimed', impressionId: 'imp-created' });
    expect(events).toEqual(['lock', 'duplicate_check', 'cap_check', 'reserve', 'insert']);
    expect(rootExecuteRaw).not.toHaveBeenCalled();
    expect(txExecuteRaw.mock.calls[1][0].join(' ')).toContain('"budget_reserved_minor"');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });
  });

  it('does not reserve for a duplicate or a user already at the exposure cap', async () => {
    const duplicate = makeClaimPrisma({ existing: { id: 'imp-existing' } });
    const duplicateService = new ExtensionService(
      duplicate.prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
        isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    await expect(duplicateService.claimImpression(claimArgs())).resolves.toEqual({
      status: 'duplicate',
    });
    expect(duplicate.events).toEqual(['lock', 'duplicate_check']);

    const capped = makeClaimPrisma({ recentCount: 6 });
    const cappedService = new ExtensionService(
      capped.prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
        isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    await expect(cappedService.claimImpression(claimArgs())).resolves.toEqual({
      status: 'cap_reached',
    });
    expect(capped.events).toEqual(['lock', 'duplicate_check', 'cap_check']);
  });

  it('returns budget_unavailable without inserting when the guarded reservation loses', async () => {
    const { prisma, adImpression, events } = makeClaimPrisma({ reserveResult: 0 });
    const service = new ExtensionService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
        isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );

    await expect(service.claimImpression(claimArgs())).resolves.toEqual({
      status: 'budget_unavailable',
    });
    expect(events).toEqual(['lock', 'duplicate_check', 'cap_check', 'reserve']);
    expect(adImpression.create).not.toHaveBeenCalled();
  });

  it('keeps the reservation inside the failed insert transaction', async () => {
    const insertError = new Error('insert failed');
    const { prisma, events, rootExecuteRaw } = makeClaimPrisma({ createError: insertError });
    const service = new ExtensionService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );

    await expect(service.claimImpression(claimArgs())).rejects.toThrow('insert failed');
    expect(events).toEqual(['lock', 'duplicate_check', 'cap_check', 'reserve', 'insert']);
    // Prisma rolls back the callback transaction; no out-of-transaction reserve
    // or compensating release is issued on the root client.
    expect(rootExecuteRaw).not.toHaveBeenCalled();
  });

  it('skips reservation for CPC impressions', async () => {
    const { prisma, events } = makeClaimPrisma();
    const service = new ExtensionService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );

    await expect(service.claimImpression(claimArgs({ bidType: BidType.cpc }))).resolves.toEqual({
      status: 'claimed',
      impressionId: 'imp-created',
    });
    expect(events).toEqual(['lock', 'duplicate_check', 'cap_check', 'insert']);
  });
});

describe('ExtensionAdTrait budget reservation', () => {
  it('releases reserved budget when the user account is inactive', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    prisma.adImpression.findUnique.mockResolvedValue({
      ...makeImpression({ bidType: 'cpm' }),
      user: { status: 'banned' },
    });

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('account_not_active');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.adImpression.updateMany).toHaveBeenCalledWith({
      where: { id: 'imp-1', qualifiedAt: null, invalidatedAt: null },
      data: expect.objectContaining({
        isBillable: false,
        invalidationReason: 'account_not_active',
        invalidatedAt: expect.any(Date),
      }),
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.adImpression.update).not.toHaveBeenCalled();
  });

  it('releases reserved budget when fraud rate limit blocks the impression', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      {
        checkImpressionRateLimit: vi
          .fn()
          .mockResolvedValue({ allowed: false, reason: 'rate_limit' }),
      } as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpm' }));

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('rate_limit');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.adImpression.updateMany).toHaveBeenCalledWith({
      where: { id: 'imp-1', qualifiedAt: null, invalidatedAt: null },
      data: expect.objectContaining({
        isBillable: false,
        invalidationReason: 'rate_limit',
        invalidatedAt: expect.any(Date),
      }),
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('releases one reservation when concurrent fraud rejections race on one impression', async () => {
    const prisma = makePrisma();
    let claimed = false;
    let reservedBudgetMinor = 200n; // This impression plus one other in-flight impression.
    prisma.adImpression.updateMany.mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    });
    prisma.$executeRaw.mockImplementation(
      async (_strings: TemplateStringsArray, amount: bigint) => {
        if (reservedBudgetMinor < amount) return 0;
        reservedBudgetMinor -= amount;
        return 1;
      },
    );
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpm' }));
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {
        checkImpressionRateLimit: vi
          .fn()
          .mockResolvedValue({ allowed: false, reason: 'rate_limit' }),
      } as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    const dto = {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    };

    const results = await Promise.all([
      service.recordQualifiedImpression('user-1', dto),
      service.recordQualifiedImpression('user-1', dto),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ qualified: false, reason: 'rate_limit' }),
      expect.objectContaining({ qualified: false, reason: 'rate_limit' }),
    ]);
    expect(prisma.adImpression.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual([100n, 'camp-1', 100n]);
    expect(reservedBudgetMinor).toBe(100n);
  });

  it('converts reserved budget to spent on qualified CPM impression', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
        isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpm' }));

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(true);
    // Conversion means the reservation is decremented inside the transaction,
    // not through the terminal-invalidation path.
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.adImpression.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invalidatedAt: null, qualifiedAt: null }),
      }),
    );
  });

  it('does not reserve or spend for CPC impressions', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
      {
        getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
        isWaitEarningsEnabled: vi.fn().mockResolvedValue(true),
        isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      } as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpc' }));

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(true);
    // No raw SQL budget update should run for CPC impressions.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
