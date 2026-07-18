import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';

describe('Audit rollback (mandatory financial events)', () => {
  let prisma: PrismaService;
  let audit: AuditService;

  beforeAll(async () => {
    // Re-use the same DATABASE_URL the API tests use.
    prisma = new PrismaService();
    await prisma.onModuleInit();
    audit = new AuditService(prisma);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect?.();
  });

  it('rolls back an audit row when the containing transaction throws', async () => {
    const actorId = 'audit-rollback-user';

    try {
      await prisma.$transaction(async (tx) => {
        await audit.logStrict(
          {
            actorId,
            actorRole: 'developer',
            action: 'request_payout',
            targetType: 'payout_request',
            targetId: 'payout-rollback-1',
            beforeSnap: { requestedAmountMinor: '1000', currency: 'USD' },
          },
          tx,
        );
        // Force the transaction to roll back.
        throw new Error('simulated post-audit failure');
      });
      // The line above must throw; reaching here is a test failure.
      expect.fail('transaction should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('simulated post-audit failure');
    }

    const persisted = await prisma.auditLog.findMany({
      where: { actorId, action: 'request_payout' },
    });
    expect(persisted).toHaveLength(0);
  });

  it('persists the audit row when the containing transaction commits', async () => {
    const actorId = 'audit-commit-user';

    await prisma.$transaction(async (tx) => {
      await audit.logStrict(
        {
          actorId,
          actorRole: 'developer',
          action: 'request_payout',
          targetType: 'payout_request',
          targetId: 'payout-commit-1',
          beforeSnap: { requestedAmountMinor: '2000', currency: 'USD' },
        },
        tx,
      );
    });

    const persisted = await prisma.auditLog.findMany({
      where: { actorId, action: 'request_payout' },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].targetId).toBe('payout-commit-1');
  });
});
