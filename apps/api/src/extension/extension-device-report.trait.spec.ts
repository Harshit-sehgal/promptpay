import { describe, expect, it, vi } from 'vitest';

import { ExtensionDeviceReportTrait } from './extension-device-report.trait';

describe('ExtensionDeviceReportTrait.reportAd retry safety', () => {
  it('retries deterministic money compensation after report invalidation already committed', async () => {
    const report = { id: 'report-1', impressionId: 'imp-1', userId: 'user-1' };
    const impression = {
      id: 'imp-1',
      userId: 'user-1',
      deviceId: 'device-1',
      creativeId: 'creative-1',
      isBillable: true,
    };
    const prisma = {
      adImpression: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(impression)
          .mockResolvedValueOnce({ ...impression, isBillable: false }),
        update: vi.fn().mockResolvedValue({ ...impression, isBillable: false }),
      },
      adReport: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(report),
        create: vi.fn().mockResolvedValue(report),
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const ledger = {
      reverseEarnings: vi
        .fn()
        .mockRejectedValueOnce(new Error('ledger unavailable after report commit'))
        .mockResolvedValueOnce({ reversed: 1, paidSkipped: 0 }),
    };
    const trait = new ExtensionDeviceReportTrait();
    Object.assign(trait, {
      prisma,
      ledger,
      audit: { log: vi.fn().mockResolvedValue(undefined) },
      logger: { warn: vi.fn() },
    });
    trait.enforcePrivacyOn = vi.fn();
    trait.verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    const dto = {
      impressionToken: 'token-1',
      reason: 'misleading',
      signature: 'valid',
    };

    await expect(trait.reportAd('user-1', dto)).rejects.toThrow('ledger unavailable');
    await expect(trait.reportAd('user-1', dto)).resolves.toEqual(report);

    expect(prisma.adReport.create).toHaveBeenCalledTimes(1);
    expect(ledger.reverseEarnings).toHaveBeenCalledTimes(2);
    expect(ledger.reverseEarnings).toHaveBeenLastCalledWith(
      { impressionId: 'imp-1' },
      'User-reported ad: misleading',
    );
  });
});
