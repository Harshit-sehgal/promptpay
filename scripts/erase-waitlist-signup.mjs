#!/usr/bin/env node
/**
 * GDPR Article 17 erasure for a single advertiser-waitlist signup.
 *
 * WHY THIS EXISTS
 * ---------------
 * The waitlist stores a marketing email — personal data. When a signup asks
 * to be removed (or an operator removes a stale entry), the row must be
 * deleted AND the audit trail referencing it must be scrubbed; the audit
 * `afterSnap` is scrubbed to null and `ipHash` nulled so no PII-derived
 * pseudonym or free-form snapshot survives. The waitlist rows are not bound
 * to a `User`, so the account-erasure machinery cannot reach them.
 *
 * DESIGN
 * ------
 * - Emails are stored normalized (lowercase) at write time, so a plain
 *   `findUnique` by email is exact.
 * - Deletes the row(s) and scrubs `audit_logs` rows with
 *   targetType='advertiser_waitlist' and targetId in the deleted ids in ONE
 *   transaction — a partial erasure (row gone, audit left) would defeat the
 *   purpose.
 * - Refuses to run against a production DB without `--confirm-production`
 *   (belt and braces: this is a destructive write).
 *
 * USAGE
 * -----
 *   DATABASE_URL=<url> node scripts/erase-waitlist-signup.mjs \
 *     --email marketing@example.com [--confirm-production]
 *
 * Exit 0 with a summary line on success; exit 1 on usage/missing-row errors.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve from the api package so workspace symlinks work regardless of cwd
// (the same trick bootstrap-admin.mjs uses).
const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, Prisma, createPrismaAdapter } = require('@waitlayer/db');

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const email = argValue('--email');
  const confirmProduction = process.argv.includes('--confirm-production');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: erase-waitlist-signup.mjs --email <email> [--confirm-production]');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && !confirmProduction) {
    console.error(
      'Refusing to erase on a production NODE_ENV without --confirm-production.',
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
  try {
    const normalized = email.trim().toLowerCase();
    const existing = await prisma.advertiserWaitlist.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (!existing) {
      console.log(`No waitlist signup found for ${normalized} — nothing to erase.`);
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.advertiserWaitlist.deleteMany({
        where: { email: normalized },
      });
      const scrubbed = await tx.auditLog.updateMany({
        where: { targetType: 'advertiser_waitlist', targetId: existing.id },
        data: { ipHash: null, afterSnap: Prisma.DbNull, beforeSnap: Prisma.DbNull },
      });
      return { deleted: deleted.count, scrubbed: scrubbed.count };
    });

    console.log(
      `Erased waitlist signup ${normalized}: ${result.deleted} row deleted, ${result.scrubbed} audit entr${result.scrubbed === 1 ? 'y' : 'ies'} scrubbed.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`Erasure failed: ${error?.message ?? error}`);
  process.exit(1);
});