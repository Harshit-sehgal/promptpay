import { Prisma } from '@ateva/db';

import type { PrismaService } from '../../config/prisma.service';

/**
 * Acquire/renew a CROSS-REPLICA cron lease atomically.
 *
 * IMPORTANT: this does NOT prevent a cron from overlapping itself inside one
 * process. The `OR "ownerId" = EXCLUDED."ownerId"` clause below is deliberate —
 * it is what lets a long-running job renew its own lease instead of losing it
 * mid-run — but it also means a second `setInterval` tick in the same process
 * re-acquires the lease successfully and runs concurrently with the first.
 *
 * Every caller therefore needs its own same-process guard. All current callers
 * have one, via one of four mechanisms depending on the workload:
 *
 *   - a boolean in-flight flag (`payout-cron`, `money-integrity`,
 *     `campaign-spend-guard`, and most others)
 *   - a shared single-flight promise (`AuditService.processOutbox`)
 *   - `FOR UPDATE SKIP LOCKED`, so overlapping runs claim disjoint rows
 *     (`email-queue.cron`)
 *   - `pg_try_advisory_xact_lock`, used instead of this lease for heavy purges
 *     (`session-cleanup.cron`, `ComplianceService.runAllRetention`)
 *
 * A new cron that calls this and nothing else will silently double-process.
 */
export async function acquireCronLease(
  prisma: PrismaService,
  key: string,
  ownerId: string,
  ttlMs: number,
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    INSERT INTO "cron_leases" ("key", "ownerId", "expiresAt", "updatedAt")
    VALUES (${key}, ${ownerId}, ${expiresAt}, NOW())
    ON CONFLICT ("key") DO UPDATE
    SET
      "ownerId" = EXCLUDED."ownerId",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = NOW()
    WHERE "cron_leases"."expiresAt" <= NOW()
       OR "cron_leases"."ownerId" = EXCLUDED."ownerId"
    RETURNING "key"
  `);
  return rows.length === 1;
}

/** Renew an already-held lease without ever taking it from another replica. */
export async function renewCronLease(
  prisma: PrismaService,
  key: string,
  ownerId: string,
  ttlMs: number,
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    UPDATE "cron_leases"
    SET "expiresAt" = ${expiresAt}, "updatedAt" = NOW()
    WHERE "key" = ${key}
      AND "ownerId" = ${ownerId}
      AND "expiresAt" > NOW()
    RETURNING "key"
  `);
  return rows.length === 1;
}
