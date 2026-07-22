import { Prisma } from '@waitlayer/db';

import type { PrismaService } from '../../config/prisma.service';

/** Acquire/renew a cross-replica cron lease atomically. */
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
