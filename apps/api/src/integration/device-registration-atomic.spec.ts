/**
 * Real-Postgres duplicate-device coverage.
 *
 * The unit contract proves the transaction shape, but only this suite can
 * exercise pg_advisory_xact_lock, the composite unique index, and rollback of
 * the device/fraud/audit writes together.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma.service';
import { ExtensionService } from '../extension/extension.service';

const fingerprint = (suffix: string) => `real-atomic-${suffix}-${Date.now()}`;

describe('device registration atomicity (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let extension: ExtensionService;
  const userIds: string[] = [];

  async function createDeveloper(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `device-atomic-${label}-${Date.now()}@waitlayer.test`,
        name: `Device Atomic ${label}`,
        passwordHash: 'test-password-hash',
        role: 'developer',
        status: 'active',
        country: 'US',
      },
    });
    userIds.push(user.id);
    return user;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    extension = app.get(ExtensionService);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('commits cross-account restriction, fraud evidence, and audit outbox atomically', async () => {
    const owner = await createDeveloper('owner');
    const contender = await createDeveloper('contender');
    const fp = fingerprint('cross-account');
    const existing = await prisma.device.create({
      data: {
        userId: owner.id,
        fingerprintHash: fp,
        eventSecret: 'owner-device-secret',
        toolType: 'vscode',
        extensionVersion: '1.0.0',
        platform: 'linux',
      },
    });

    const registered = await extension.registerDevice(contender.id, {
      toolType: 'vscode',
      fingerprintHash: fp,
      extensionVersion: '1.0.0',
      platform: 'linux',
    });

    expect(registered.userId).toBe(contender.id);
    await expect(prisma.device.findUnique({ where: { id: registered.id } })).resolves.toMatchObject(
      { userId: contender.id },
    );
    await expect(
      prisma.user.findUnique({ where: { id: contender.id }, select: { trustLevel: true } }),
    ).resolves.toMatchObject({ trustLevel: 'restricted' });
    await expect(
      prisma.fraudFlag.findFirst({
        where: { userId: contender.id, flagType: 'duplicate_device' },
      }),
    ).resolves.toMatchObject({ deviceId: existing.id, severity: 'high' });
    await expect(
      prisma.auditOutbox.findFirst({
        where: { targetType: 'device', targetId: registered.id },
      }),
    ).resolves.toMatchObject({ action: 'duplicate_device_allowed_restricted' });
  });

  it('rolls back the device and fraud restriction when the audit outbox write fails', async () => {
    const owner = await createDeveloper('rollback-owner');
    const contender = await createDeveloper('rollback-contender');
    const fp = fingerprint('rollback');
    await prisma.device.create({
      data: {
        userId: owner.id,
        fingerprintHash: fp,
        eventSecret: 'rollback-owner-secret',
        toolType: 'vscode',
        extensionVersion: '1.0.0',
        platform: 'linux',
      },
    });
    const triggerName = 'waitlayer_device_atomic_test_outbox_failure';
    const functionName = 'waitlayer_device_atomic_test_outbox_failure_fn';
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional atomicity test failure'; RETURN NEW; END; $$;
      CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "audit_outbox"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await expect(
        extension.registerDevice(contender.id, {
          toolType: 'vscode',
          fingerprintHash: fp,
          extensionVersion: '1.0.0',
          platform: 'linux',
        }),
      ).rejects.toThrow(/intentional atomicity test failure|transaction/i);
    } finally {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS "${triggerName}" ON "audit_outbox";
        DROP FUNCTION IF EXISTS "${functionName}"();
      `);
    }

    await expect(
      prisma.device.findUnique({
        where: { userId_fingerprintHash: { userId: contender.id, fingerprintHash: fp } },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({ where: { id: contender.id }, select: { trustLevel: true } }),
    ).resolves.toMatchObject({ trustLevel: 'new' });
    await expect(
      prisma.fraudFlag.findFirst({ where: { userId: contender.id, flagType: 'duplicate_device' } }),
    ).resolves.toBeNull();
  });

  it('serializes same-user first registration and avoids a raw unique-constraint error', async () => {
    const user = await createDeveloper('same-user-race');
    const fp = fingerprint('same-user');
    const request = () =>
      extension.registerDevice(user.id, {
        toolType: 'vscode',
        fingerprintHash: fp,
        extensionVersion: '1.0.0',
        platform: 'linux',
      });

    const results = await Promise.allSettled([request(), request()]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 401 });
    await expect(
      prisma.device.count({ where: { userId: user.id, fingerprintHash: fp } }),
    ).resolves.toBe(1);
  });
});
