#!/usr/bin/env node
/**
 * Seed a database with a small, financially-balanced reference dataset for the
 * backup/restore DR drill. Writes via Prisma (handles snake_case column mapping)
 * and is idempotent (upserts by fixed IDs).
 *
 * The seeded ledger is balanced: advertiser debit (1000) == developer credit
 * (800) + platform fee (150) + fraud reserve (50), so verify-backup.mjs's
 * per-currency invariant holds.
 *
 * Env: DATABASE_URL (target). Exit: 0 seeded, 1 failed.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(join(__dirname, '..', 'apps', 'api', 'package.json'));
const { PrismaClient, createPrismaAdapter } = apiRequire('@waitlayer/db');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: createPrismaAdapter(url) });

async function main() {
  const user = await prisma.user.upsert({
    where: { id: 'dr-user-1' },
    update: {},
    create: {
      id: 'dr-user-1',
      email: 'dr@waitlayer.com',
      role: 'developer',
      status: 'active',
      emailVerified: true,
      referralCode: 'DR000001',
    },
  });

  const advertiser = await prisma.advertiser.upsert({
    where: { id: 'dr-adv-1' },
    update: {},
    create: {
      id: 'dr-adv-1',
      userId: user.id,
      companyName: 'DR Co',
      billingEmail: 'dr@waitlayer.com',
    },
  });

  await prisma.campaign.upsert({
    where: { id: 'dr-camp-1' },
    update: {},
    create: {
      id: 'dr-camp-1',
      advertiserId: advertiser.id,
      name: 'DR Campaign',
      status: 'active',
      category: 'tech',
      bidType: 'cpm',
      bidAmountMinor: 100n,
      budgetTotalMinor: 100000n,
      budgetSpentMinor: 0n,
      currency: 'USD',
    },
  });

  // Balanced ledger: advertiser debit 1000 == dev credit 800 + fee 150 + reserve 50
  await prisma.advertiserLedger.upsert({
    where: { id: 'dr-adv-ledger-1' },
    update: {},
    create: {
      id: 'dr-adv-ledger-1',
      advertiserId: advertiser.id,
      campaignId: 'dr-camp-1',
      entryType: 'debit',
      status: 'confirmed',
      currency: 'USD',
      amountMinor: 1000n,
      idempotencyKey: 'dr-adv-1',
    },
  });
  await prisma.earningsLedger.upsert({
    where: { id: 'dr-earn-1' },
    update: {},
    create: {
      id: 'dr-earn-1',
      userId: user.id,
      entryType: 'credit',
      status: 'confirmed',
      currency: 'USD',
      amountMinor: 800n,
      idempotencyKey: 'dr-earn-1',
    },
  });
  await prisma.platformLedger.upsert({
    where: { id: 'dr-fee-1' },
    update: {},
    create: {
      id: 'dr-fee-1',
      entryType: 'credit',
      bucket: 'platform_fee',
      status: 'confirmed',
      currency: 'USD',
      amountMinor: 150n,
      idempotencyKey: 'dr-fee-1',
    },
  });
  await prisma.platformLedger.upsert({
    where: { id: 'dr-res-1' },
    update: {},
    create: {
      id: 'dr-res-1',
      entryType: 'credit',
      bucket: 'fraud_reserve',
      status: 'confirmed',
      currency: 'USD',
      amountMinor: 50n,
      idempotencyKey: 'dr-res-1',
    },
  });

  console.log('Seeded DR reference data: 1 user, 1 advertiser, 1 campaign, 4 balanced ledger rows.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
