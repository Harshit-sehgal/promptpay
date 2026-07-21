#!/usr/bin/env node
// Backfills legacy plaintext payout destinations.
//
// Iterates every payout_account row where:
//   - destination does NOT start with the encrypted prefix "v1:"
//   - destinationHmac is missing
// For each legacy row it:
//   1. encrypts the plaintext destination with the configured PAYOUT_ENCRYPTION_KEY
//   2. computes a deterministic HMAC with the configured PAYOUT_HMAC_KEY
//   3. updates the row inside a transaction
//
// The script is idempotent — re-running it only touches rows that are still
// plaintext or still lack an destinationHmac. Encrypted rows and rows with
// HMACs are left untouched.
//
// Run with the same environment as the API (DATABASE_URL etc.).

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env only if present; production runs should already have env vars set.
try {
  const dotenvPath = path.resolve(__dirname, '../packages/config/.env');
  const envContent = await readFile(dotenvPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length > 0 && !process.env[key]) {
      process.env[key] = rest.join('=').replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // .env is optional
}

const { PrismaClient } = await import('@waitlayer/db');
const payoutEncryption = await import('../apps/api/dist/apps/api/src/common/utils/payout-encryption.js');

const prisma = new PrismaClient();

const BATCH_SIZE = 100;

async function main() {
  const totalLegacy = await prisma.payoutAccount.count({
    where: {
      OR: [
        { destination: { not: { startsWith: 'v1:' } } },
        { destinationHmac: null },
        { destinationHmac: '' },
      ],
    },
  });

  if (totalLegacy === 0) {
    console.log('✅ No legacy plaintext payout destinations need backfill.');
    return;
  }

  console.log(`🔐 Backfilling ${totalLegacy} payout destination(s)...`);

  let processed = 0;
  let cursor = null;

  while (true) {
    const rows = await prisma.payoutAccount.findMany({
      where: {
        OR: [
          { destination: { not: { startsWith: 'v1:' } } },
          { destinationHmac: null },
          { destinationHmac: '' },
        ],
      },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, destination: true, destinationHmac: true },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const rawDestination = row.destination;
      const isEncrypted = rawDestination.startsWith('v1:');

      // If the destination is already encrypted but missing HMAC, we cannot
      // re-derive the plaintext without the encryption key. That should never
      // happen because addPayoutMethod writes both together, but guard against
      // it by leaving the row alone and logging loudly.
      if (isEncrypted && (!row.destinationHmac || row.destinationHmac === '')) {
        console.warn(
          `⚠️ PayoutAccount ${row.id} is encrypted but has no HMAC; cannot recover plaintext. Skipping.`,
        );
        continue;
      }

      // Only plaintext rows reach this branch (encrypted rows without HMAC are
      // warned and skipped above).
      const encrypted = payoutEncryption.encryptPayoutDestination(rawDestination);
      const hmac = payoutEncryption.hmacPayoutDestination(rawDestination);

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
          data: { destination: encrypted, destinationHmac: hmac },
        });
      });

      processed++;
    }

    cursor = rows[rows.length - 1].id;
    console.log(`  processed ${processed}/${totalLegacy}...`);
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
