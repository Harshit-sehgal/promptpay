/**
 * Backfills legacy plaintext payout destinations.
 *
 * Iterates every payout_account row whose destination is plaintext (does not
 * start with an encrypted v1:/v2: prefix). For each legacy row it:
 *   1. encrypts the plaintext destination as AAD-bound v2 ciphertext with the
 *      configured PAYOUT_ENCRYPTION_KEY
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

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@waitlayer/db';

import {
  assertPayoutDestinationKeysConfigured,
  encryptPayoutDestination,
  hmacPayoutDestination,
  isEncryptedDestination,
} from '../apps/api/src/common/utils/payout-encryption';

const BATCH_SIZE = Number(process.env.PAYOUT_BACKFILL_BATCH_SIZE) || 100;
const MAX_ITERATIONS = Number(process.env.PAYOUT_BACKFILL_MAX_ITERATIONS) || 100_000;

interface LegacyPayoutAccountRow {
  id: string;
  userId: string;
  provider: string;
  destination: string;
  currency: string;
}

interface PayoutAccountBackfillStore {
  payoutAccount: {
    count(args: object): Promise<number>;
    findMany(args: object): Promise<LegacyPayoutAccountRow[]>;
  };
  $transaction<T>(callback: (tx: PayoutAccountBackfillTransaction) => Promise<T>): Promise<T>;
}

interface PayoutAccountBackfillTransaction {
  payoutAccount: {
    findUnique(args: object): Promise<LegacyPayoutAccountRow | null>;
    update(args: object): Promise<unknown>;
  };
}

interface BackfillLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface BackfillOptions {
  batchSize?: number;
  maxIterations?: number;
  logger?: BackfillLogger;
}

const plaintextDestinationWhere = {
  AND: [
    { destination: { not: { startsWith: 'v1:' } } },
    { destination: { not: { startsWith: 'v2:' } } },
  ],
  // Erasure deliberately replaces the destination with a non-identifying
  // tombstone and clears its cryptographic metadata. Never recreate a
  // destination fingerprint for an erased subject during a later backfill.
  user: { status: { not: 'deleted' } },
};

function isDevOrTest(): boolean {
  const env = process.env.NODE_ENV ?? '';
  return env === 'development' || env === 'test';
}

function requireProductionKeys() {
  // In development/test the encryption utility supplies a deterministic
  // fallback so the script can be exercised locally. In every other mode
  // (including an unset NODE_ENV), real keys are mandatory to avoid silently
  // encrypting live destinations with a dev key.
  if (isDevOrTest()) return;

  assertPayoutDestinationKeysConfigured();
}

export async function backfillLegacyPayoutDestinations(
  prisma: PayoutAccountBackfillStore,
  options: BackfillOptions = {},
): Promise<{ processed: number; remaining: number }> {
  requireProductionKeys();

  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS;
  const logger = options.logger ?? console;

  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('PAYOUT_BACKFILL_BATCH_SIZE must be a positive integer');
  }
  if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0) {
    throw new Error('PAYOUT_BACKFILL_MAX_ITERATIONS must be a positive integer');
  }

  const totalLegacy = await prisma.payoutAccount.count({
    where: plaintextDestinationWhere,
  });

  if (totalLegacy === 0) {
    logger.log('No legacy plaintext payout destinations need backfill.');
    return { processed: 0, remaining: 0 };
  }

  logger.log(`Backfilling ${totalLegacy} payout destination(s)...`);

  let processed = 0;
  let cursor: string | null = null;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const rows = await prisma.payoutAccount.findMany({
      where: plaintextDestinationWhere,
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        provider: true,
        destination: true,
        currency: true,
      },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const didUpdate = await prisma.$transaction(async (tx) => {
        // Re-read the row under the transaction to avoid TOCTOU with a
        // concurrent addPayoutMethod call.
        const current = await tx.payoutAccount.findUnique({
          where: { id: row.id },
          select: {
            id: true,
            userId: true,
            provider: true,
            destination: true,
            currency: true,
          },
        });
        if (!current) return false;
        if (isEncryptedDestination(current.destination)) {
          // Another process backfilled this row already.
          return false;
        }

        const binding = {
          accountId: current.id,
          userId: current.userId,
          provider: current.provider,
          currency: current.currency,
        };
        const encrypted = encryptPayoutDestination(current.destination, binding);
        const hmac = hmacPayoutDestination(current.destination);
        await tx.payoutAccount.update({
          where: { id: row.id },
          data: {
            destination: encrypted,
            destinationHmac: hmac,
            encryptionMigratedAt: new Date(),
          },
        });
        return true;
      });

      if (didUpdate) processed++;
    }

    cursor = rows[rows.length - 1].id;
    logger.log(`processed ${processed}/${totalLegacy}...`);
  }

  const remaining = await prisma.payoutAccount.count({
    where: plaintextDestinationWhere,
  });
  if (remaining > 0) {
    throw new Error(
      `Reached maximum iteration safety limit (${maxIterations}). ${remaining} plaintext row(s) remain unprocessed.`,
    );
  }

  logger.log(`Backfilled ${processed} payout destination(s).`);
  return { processed, remaining };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await backfillLegacyPayoutDestinations(prisma as unknown as PayoutAccountBackfillStore);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  });
}
