import { describe, expect, it, vi } from 'vitest';

import { privacyPseudonym } from '../common/utils/privacy-hash';
import { ExtensionDeviceReportTrait } from './extension-device-report.trait';

function makeTrait(overrides: Record<string, unknown> = {}) {
  const owner = { userId: 'owner-1', id: 'owner-device-1' };
  const device = { id: 'new-device-1', userId: 'new-user-1', eventSecret: 'secret' };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    device: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(owner),
      create: vi.fn().mockResolvedValue(device),
      update: vi.fn().mockResolvedValue({ ...device, eventSecret: 'rotated-secret' }),
    },
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    fraudFlag: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'flag-1' }),
    },
    auditOutbox: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
  };
  const prisma = {
    device: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ ...device, eventSecret: 'rotated-secret' }),
    },
    toolIntegration: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const trait = new ExtensionDeviceReportTrait();
  Object.assign(trait, {
    prisma,
    runtimeConfig: {
      isToolEnabled: vi.fn().mockResolvedValue(true),
      isExtensionVersionAllowed: vi.fn().mockResolvedValue(true),
    },
    fraud: {
      checkVpnProxyPattern: vi.fn().mockResolvedValue(undefined),
      checkEmulatorVmPattern: vi.fn().mockResolvedValue(undefined),
      checkDuplicateAccount: vi.fn().mockResolvedValue(undefined),
    },
    audit: { log: vi.fn().mockResolvedValue(undefined) },
    logger: { warn: vi.fn() },
    enforcePrivacyOn: vi.fn(),
    ...overrides,
  });
  return { trait, prisma, tx, device };
}

describe('ExtensionDeviceReportTrait.registerDevice duplicate-device safety', () => {
  it('commits the device, restriction, fraud flag, and audit outbox together', async () => {
    const { trait, prisma, tx, device } = makeTrait();

    await expect(
      trait.registerDevice('new-user-1', {
        toolType: 'vscode',
        fingerprintHash: 'fingerprint-1',
        extensionVersion: '1.2.3',
      }),
    ).resolves.toEqual(device);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'new-user-1', trustLevel: { notIn: ['restricted', 'banned'] } },
      data: { trustLevel: 'restricted' },
    });
    expect(tx.fraudFlag.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'new-user-1',
        deviceId: 'owner-device-1',
        flagType: 'duplicate_device',
        severity: 'high',
      }),
    });
    expect(tx.auditOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'duplicate_device_allowed_restricted',
        targetId: 'new-device-1',
      }),
    });
    expect(tx.device.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.auditOutbox.create.mock.invocationCallOrder[0],
    );
  });

  it('propagates audit failure so the transaction can roll back the new device', async () => {
    const { trait, tx } = makeTrait();
    tx.auditOutbox.create.mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(
      trait.registerDevice('new-user-1', {
        toolType: 'vscode',
        fingerprintHash: 'fingerprint-1',
        extensionVersion: '1.2.3',
      }),
    ).rejects.toThrow('outbox unavailable');
  });

  it('derives a server-keyed pseudonym from the installation identity', async () => {
    process.env.PRIVACY_HASH_KEY = 'test-installation-pseudonym-key-at-least-32';
    const { trait, tx } = makeTrait();
    tx.device.findFirst.mockResolvedValueOnce(null);

    await trait.registerDevice('new-user-1', {
      toolType: 'vscode',
      installationId: 'd7c4d9c5-4b73-4f98-9f33-54d6f8f0132b',
      extensionVersion: '1.2.3',
    });

    expect(tx.device.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fingerprintHash: privacyPseudonym(
          'd7c4d9c5-4b73-4f98-9f33-54d6f8f0132b',
          'device-installation',
        ),
      }),
    });
    expect(tx.device.create.mock.calls[0]?.[0].data.fingerprintHash).not.toContain(
      'd7c4d9c5-4b73-4f98-9f33-54d6f8f0132b',
    );
    delete process.env.PRIVACY_HASH_KEY;
  });

  it('keeps legacy fingerprint-only registration unchanged', async () => {
    const { trait, tx } = makeTrait();

    await trait.registerDevice('new-user-1', {
      toolType: 'vscode',
      fingerprintHash: 'legacy-fingerprint-123456',
      extensionVersion: '1.2.3',
    });

    expect(tx.device.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fingerprintHash: 'legacy-fingerprint-123456' }),
    });
  });

  it('rejects registration when neither installationId nor legacy fingerprint is supplied', async () => {
    const { trait } = makeTrait();

    await expect(
      trait.registerDevice('new-user-1', { toolType: 'vscode', extensionVersion: '1.2.3' }),
    ).rejects.toThrow('installationId is required');
  });

  it('rechecks same-user ownership after locking and rotates instead of racing into a unique error', async () => {
    const { trait, prisma, tx } = makeTrait();
    prisma.device.findUnique.mockResolvedValueOnce(null);
    prisma.device.update.mockResolvedValueOnce({
      id: 'existing-device-1',
      eventSecret: 'rotated-secret',
    });
    tx.device.findUnique.mockImplementation(async () => {
      return { id: 'existing-device-1', eventSecret: 'secret' };
    });

    const result = await trait.registerDevice('new-user-1', {
      toolType: 'vscode',
      fingerprintHash: 'fingerprint-1',
      extensionVersion: '1.2.3',
      existingEventSecret: 'secret',
    });
    expect(result).toMatchObject({ id: 'existing-device-1', eventSecret: expect.any(String) });
    expect(result.eventSecret).not.toBe('secret');
    expect(tx.device.create).not.toHaveBeenCalled();
    expect(tx.device.update).not.toHaveBeenCalled();
  });
});
