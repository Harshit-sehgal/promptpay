/**
 * Backfills legacy plaintext payout destinations.
 *
 * Iterates every payout_account row whose destination is plaintext (does not
 * start with the encrypted prefix "v1:"). For each legacy row it:
 *   1. encrypts the plaintext destination with the configured PAYOUT_ENCRYPTION_KEY
 *   2. computes a deterministic HMAC with the configured PAYOUT_HMAC_KEY
 *   3. updates the row inside a transaction
 *
 * The script is idempotent — re-running it only touches rows that are still
 * plaintext. This deliberately repairs a partially-migrated row that already
 * has an HMAC but still stores its destination in plaintext.
 *
 * Run with the same environment as the API (DATABASE_URL etc.):
 *   pnpm exec tsx scripts/encrypt-legacy-payout-destinations.ts
 */

import { PrismaClient } from '@waitlayer/db';

import {
  encryptPayoutDestination,
  hmacPayoutDestination,
} from '../apps/api/src/common/utils/payout-encryption';

const prisma = new PrismaClient();

const BATCH_SIZE = Number(process.env.PAYOUT_BACKFILL_BATCH_SIZE) || 100;
const MAX_ITERATIONS = Number(process.env.PAYOUT_BACKFILL_MAX_ITERATIONS) || 100_000;

function isDevOrTest(): boolean {
  const env = process.env.NODE_ENV ?? '';
  return env === 'development' || env === 'test';
}

function validateKey(name: string, raw: string | undefined): void {
  if (!raw) {
    throw new Error(
      `${name} is required in ${process.env.NODE_ENV ?? 'production'} and must be a base64-encoded 32-byte key`,
    );
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (got ${decoded.length} bytes)`);
  }
}

function requireProductionKeys() {
  // In development/test or when NODE_ENV is unset, the encryption utility
  // supplies a deterministic fallback so the script can be exercised locally.
  // In any other environment (production, staging, etc.), real keys are
  // mandatory to avoid silently encrypting live destinations with a dev key.
  if (isDevOrTest()) return;

  validateKey('PAYOUT_ENCRYPTION_KEY', process.env.PAYOUT_ENCRYPTION_KEY);
  validateKey('PAYOUT_HMAC_KEY', process.env.PAYOUT_HMAC_KEY);
}

async function main() {
  requireProductionKeys();

  const totalLegacy = await prisma.payoutAccount.count({
    where: {
      destination: { not: { startsWith: 'v1:' } },
    },
  });

  if (totalLegacy === 0) {
    console.log(' No legacy plaintext payout destinations need backfill.');
    return;
  }

  console.log(`🔐 Backfilling ${totalLegacy} payout destination(s)...`);

  let processed = 0;
  let cursor: string | null = null;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const rows = await prisma.payoutAccount.findMany({
      where: {
        destination: { not: { startsWith: 'v1:' } },
      },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, destination: true, destinationHmac: true },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const rawDestination = row.destination;

      // Only plaintext rows are selected now, but guard defensively.
      if (rawDestination.startsWith('v1:')) {
        console.warn(`⚠️ PayoutAccount ${row.id} is already encrypted; skipping.`);
        continue;
      }

      const encrypted = encryptPayoutDestination(rawDestination);
      const hmac = hmacPayoutDestination(rawDestination);

      await prisma.$transaction(async (tx) => {
        // Re-read the row under the transaction to avoid TOCTOU with a
        // concurrent addPayoutMethod call.
        const current = await tx.payoutAccount.findUnique({
          where: { id: row.id },
          select: { destination: true, destinationHmac: true },
        });
        if (!current) return;
        if (current.destination.startsWith('v1:') && current.destinationHmac) {
          // Another process backfilled this row already.
          return;
        }
        await tx.payoutAccount.update({
          where: { id: row.id },
          data: {
            destination: encrypted,
            destinationHmac: hmac,
            encryptionMigratedAt: new Date(),
          },
        });
      });

      processed++;
    }

    cursor = rows[rows.length - 1].id;
    console.log(`  processed ${processed}/${totalLegacy}...`);
  }

  if (iterations >= MAX_ITERATIONS) {
    const remaining = await prisma.payoutAccount.count({
      where: {
        AND: [
          { destination: { not: { startsWith: 'v1:' } } },
          { OR: [{ destinationHmac: null }, { destinationHmac: '' }] },
        ],
      },
    });
    console.error(
      `❌ Reached maximum iteration safety limit (${MAX_ITERATIONS}). ${remaining} plaintext row(s) remain unprocessed.`,
    );
    process.exit(1);
  }

  console.log(`✅ Backfilled ${processed} payout destination(s).`);
}

main()
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
