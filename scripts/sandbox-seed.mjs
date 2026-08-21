#!/usr/bin/env node
/**
 * Idempotently seed the isolated sandbox house campaign. This script refuses
 * development, staging, and production databases even when a caller supplies
 * a misleading local environment variable; the persisted environment marker
 * must also say sandbox/test with the same environment id.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = require('@ateva/db');

const kind = process.env.ATEVA_ENVIRONMENT_KIND;
const environmentId = process.env.ATEVA_ENVIRONMENT_ID ?? 'local';
const databaseUrl = process.env.DATABASE_URL;
if (kind !== 'sandbox' && kind !== 'test')
  throw new Error('sandbox-seed requires ATEVA_ENVIRONMENT_KIND=sandbox or test');
if (!databaseUrl) throw new Error('sandbox-seed requires DATABASE_URL');

const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
const IDS = {
  user: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  advertiser: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  campaign: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  creative: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

async function main() {
  const marker = await prisma.environmentMarker.findUnique({ where: { id: 1 } });
  if (!marker || marker.environmentKind !== kind || marker.environmentId !== environmentId) {
    throw new Error('sandbox-seed environment marker does not match the requested sandbox');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: IDS.user },
      update: { status: 'active', role: 'advertiser' },
      create: {
        id: IDS.user,
        email: `sandbox-house-${environmentId}@ateva.test`,
        name: 'Ateva Sandbox House',
        role: 'advertiser',
        status: 'active',
        emailVerified: true,
      },
    });
    await tx.advertiser.upsert({
      where: { id: IDS.advertiser },
      update: { companyName: 'Ateva Sandbox House' },
      create: {
        id: IDS.advertiser,
        userId: IDS.user,
        companyName: 'Ateva Sandbox House',
        billingEmail: `sandbox-house-${environmentId}@ateva.test`,
      },
    });
    await tx.campaign.upsert({
      where: { id: IDS.campaign },
      update: {
        status: 'active',
        currency: 'XTS',
        bidType: 'cpm',
        budgetTotalMinor: 100_000_000n,
        budgetSpentMinor: 0n,
        budgetReservedMinor: 0n,
      },
      create: {
        id: IDS.campaign,
        advertiserId: IDS.advertiser,
        name: 'Sandbox House Campaign',
        status: 'active',
        category: 'developer-tools',
        bidType: 'cpm',
        bidAmountMinor: 25n,
        budgetTotalMinor: 100_000_000n,
        currency: 'XTS',
      },
    });
    await tx.adCreative.upsert({
      where: { id: IDS.creative },
      update: { status: 'approved', destinationUrl: 'https://sandbox.ateva.test/house' },
      create: {
        id: IDS.creative,
        campaignId: IDS.campaign,
        title: 'Ateva Sandbox House',
        sponsoredMessage: 'This is a simulated placement for testing only.',
        destinationUrl: 'https://sandbox.ateva.test/house',
        displayDomain: 'sandbox.ateva.test',
        ctaText: 'Learn about the sandbox',
        status: 'approved',
      },
    });
    for (const placementType of ['foreground_wait', 'completion_return']) {
      await tx.campaignPlacement.upsert({
        where: { campaignId_placementType: { campaignId: IDS.campaign, placementType } },
        update: { isActive: true, bidType: 'cpm', bidAmountMinor: 25n },
        create: {
          campaignId: IDS.campaign,
          placementType,
          bidType: 'cpm',
          bidAmountMinor: 25n,
          isActive: true,
        },
      });
    }
  });
  console.log(
    JSON.stringify({
      environmentKind: kind,
      environmentId,
      campaignId: IDS.campaign,
      placements: 2,
      cashValue: false,
    }),
  );
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
