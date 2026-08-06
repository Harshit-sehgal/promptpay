#!/usr/bin/env node
/** Reset only sandbox-owned opportunities and XTS credits in a marked sandbox. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = require('@waitlayer/db');
const args = new Set(process.argv.slice(2));
const kind = process.env.WAITLAYER_ENVIRONMENT_KIND;
const environmentId = process.env.WAITLAYER_ENVIRONMENT_ID ?? 'local';
const databaseUrl = process.env.DATABASE_URL;
if (kind !== 'sandbox' && kind !== 'test')
  throw new Error('sandbox-reset requires WAITLAYER_ENVIRONMENT_KIND=sandbox or test');
if (!args.has('--confirm-sandbox-reset'))
  throw new Error('pass --confirm-sandbox-reset to reset sandbox state');
if (!databaseUrl) throw new Error('sandbox-reset requires DATABASE_URL');

const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
async function main() {
  const marker = await prisma.environmentMarker.findUnique({ where: { id: 1 } });
  if (!marker || marker.environmentKind !== kind || marker.environmentId !== environmentId) {
    throw new Error('sandbox-reset environment marker does not match the requested sandbox');
  }
  const result = await prisma.$transaction(async (tx) => {
    const payouts = await tx.sandboxPayoutSimulation.deleteMany({ where: { environmentId } });
    const deposits = await tx.sandboxDepositSimulation.deleteMany({ where: { environmentId } });
    const entries = await tx.sandboxCreditEntry.deleteMany({ where: { environmentId } });
    const accounts = await tx.sandboxCreditAccount.deleteMany({ where: { environmentId } });
    // The environment marker proves this database is the isolated sandbox;
    // AdOpportunity predates environment_id and is therefore scoped by the
    // database marker rather than by a row column.
    const opportunities = await tx.adOpportunity.deleteMany({});
    return {
      payouts: payouts.count,
      deposits: deposits.count,
      entries: entries.count,
      accounts: accounts.count,
      opportunities: opportunities.count,
    };
  });
  console.log(JSON.stringify({ environmentKind: kind, environmentId, reset: result }));
}
main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
