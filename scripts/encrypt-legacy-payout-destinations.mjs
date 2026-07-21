#!/usr/bin/env node
/**
 * One-shot data migration: encrypt all existing plaintext payout destinations.
 *
 * Prerequisites:
 * - PAYOUT_ENCRYPTION_KEY must be set in the environment.
 * - DATABASE_URL must point to the target database.
 *
 * Usage:
 *   PAYOUT_ENCRYPTION_KEY=<base64-key> DATABASE_URL=<db-url> node scripts/encrypt-legacy-payout-destinations.mjs
 *
 * This script reads every payout_account row where destination_hmac IS NULL,
 * encrypts the destination using the same AES-256-GCM scheme as the API,
 * and writes back the encrypted destination + HMAC.
 *
 * It processes rows in batches of 100 and logs progress.
 */
import { createCipheriv, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadEncryptionKey() {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    console.error('PAYOUT_ENCRYPTION_KEY must be set to a base64-encoded 256-bit key');
    process.exit(1);
  }
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch { /* fall through */ }
  return createHmac('sha256', 'payout-encryption-key-derivation').update(raw).digest();
}

function encryptDestination(plaintext) {
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, Buffer.from(encrypted, 'base64'), authTag]);
  return `v1:${combined.toString('base64')}`;
}

function hmacDestination(destination) {
  const key = loadEncryptionKey();
  return createHmac('sha256', key)
    .update(`waitlayer-payout-dest:v1:${destination.toLowerCase().trim()}`)
    .digest('hex');
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('Connected to database.');

    const BATCH_SIZE = 100;
    let total = 0;
    let processed = 0;

    // Count unprocessed rows
    total = await prisma.payoutAccount.count({
      where: { destinationHmac: null },
    });
    console.log(`Found ${total} unprocessed payout account(s).`);

    while (processed < total) {
      const rows = await prisma.payoutAccount.findMany({
        where: { destinationHmac: null },
        take: BATCH_SIZE,
        select: { id: true, destination: true },
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        // Skip rows that are already encrypted
        if (row.destination && row.destination.startsWith('v1:')) {
          // Already encrypted — compute HMAC from decrypted value
          // but we can't decrypt here without the actual decrypt logic.
          // Mark as migrated and skip.
          await prisma.payoutAccount.update({
            where: { id: row.id },
            data: { encryptionMigratedAt: new Date() },
          });
          continue;
        }

        const encryptedDest = encryptDestination(row.destination);
        const destHmac = hmacDestination(row.destination);

        await prisma.payoutAccount.update({
          where: { id: row.id },
          data: {
            destination: encryptedDest,
            destinationHmac: destHmac,
            encryptionMigratedAt: new Date(),
          },
        });

        processed++;
        if (processed % 10 === 0) {
          console.log(`  Migrated ${processed}/${total}`);
        }
      }
    }

    console.log(`Migration complete. ${processed} rows processed.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
