#!/usr/bin/env node
/** Read-only invariant check for an isolated sandbox/test database. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = require('@waitlayer/db');

const kind = process.env.WAITLAYER_ENVIRONMENT_KIND;
const environmentId = process.env.WAITLAYER_ENVIRONMENT_ID ?? 'local';
const databaseUrl = process.env.DATABASE_URL;
if (kind !== 'sandbox' && kind !== 'test')
  throw new Error('sandbox-reconcile requires WAITLAYER_ENVIRONMENT_KIND=sandbox or test');
if (!databaseUrl) throw new Error('sandbox-reconcile requires DATABASE_URL');

const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

async function main() {
  const marker = await prisma.environmentMarker.findUnique({ where: { id: 1 } });
  if (!marker || marker.environmentKind !== kind || marker.environmentId !== environmentId) {
    throw new Error('sandbox-reconcile environment marker does not match the requested sandbox');
  }

  const accounts = await prisma.sandboxCreditAccount.findMany({
    where: { environmentId },
    include: {
      entries: {
        select: { amountMinor: true, currency: true, environmentId: true, entryType: true },
      },
    },
  });
  const violations = [];
  let totalBalanceMinor = 0n;
  let totalEntryMinor = 0n;
  for (const account of accounts) {
    const sum = account.entries.reduce((total, entry) => {
      if (entry.currency !== 'XTS' || entry.environmentId !== environmentId)
        violations.push(`credit entry ${account.id} has invalid currency or environment`);
      const signedAmount = ['payout_debit', 'deposit_refund', 'deposit_chargeback'].includes(
        entry.entryType,
      )
        ? -entry.amountMinor
        : entry.amountMinor;
      return total + signedAmount;
    }, 0n);
    totalBalanceMinor += account.balanceMinor;
    totalEntryMinor += sum;
    if (account.currency !== 'XTS' || account.balanceMinor < 0n || account.balanceMinor !== sum) {
      violations.push(
        `credit account ${account.id} balance does not equal its append-only entries`,
      );
    }
  }

  const [xtsCampaigns, xtsEarnings, xtsAdvertiser, xtsPlatform, xtsPayouts] = await Promise.all([
    prisma.campaign.findMany({
      where: { currency: 'XTS' },
      select: {
        id: true,
        impressions: { select: { id: true } },
        earningsEntries: { select: { id: true } },
      },
    }),
    prisma.earningsLedger.count({ where: { currency: 'XTS' } }),
    prisma.advertiserLedger.count({ where: { currency: 'XTS' } }),
    prisma.platformLedger.count({ where: { currency: 'XTS' } }),
    prisma.payoutRequest.count({ where: { currency: 'XTS' } }),
  ]);
  const [simulations, deposits] = await Promise.all([
    prisma.sandboxPayoutSimulation.findMany({
      where: { environmentId },
      select: { currency: true, amountMinor: true, account: { select: { environmentId: true } } },
    }),
    prisma.sandboxDepositSimulation.findMany({
      where: { environmentId },
      select: {
        currency: true,
        amountMinor: true,
        status: true,
        account: { select: { environmentId: true } },
      },
    }),
  ]);
  for (const simulation of simulations) {
    if (
      simulation.currency !== 'XTS' ||
      simulation.amountMinor <= 0n ||
      simulation.account.environmentId !== environmentId
    ) {
      violations.push(
        'sandbox payout simulation has invalid currency, amount, or account environment',
      );
    }
  }
  for (const deposit of deposits) {
    if (
      deposit.currency !== 'XTS' ||
      deposit.amountMinor <= 0n ||
      deposit.account.environmentId !== environmentId ||
      ![
        'approved',
        'processing',
        'declined',
        'refunded',
        'disputed',
        'timeout',
        'duplicate_callback',
        'delayed_callback',
        'callback_before_response',
        'currency_mismatch',
        'amount_mismatch',
      ].includes(deposit.status)
    ) {
      violations.push(
        'sandbox deposit simulation has invalid currency, amount, status, or account environment',
      );
    }
  }
  const campaignsWithFinancialRows = xtsCampaigns.filter(
    (campaign) => campaign.impressions.length > 0 || campaign.earningsEntries.length > 0,
  );
  if (
    campaignsWithFinancialRows.length ||
    xtsEarnings ||
    xtsAdvertiser ||
    xtsPlatform ||
    xtsPayouts
  ) {
    violations.push(
      'XTS is attached to financial or impression rows; sandbox settlement must remain disabled',
    );
  }
  if (violations.length) throw new Error(`sandbox reconciliation failed: ${violations.join('; ')}`);

  console.log(
    JSON.stringify({
      environmentKind: kind,
      environmentId,
      accounts: accounts.length,
      simulations: { payouts: simulations.length, deposits: deposits.length },
      totalBalanceMinor: totalBalanceMinor.toString(),
      totalEntryMinor: totalEntryMinor.toString(),
      xtsCampaigns: xtsCampaigns.length,
      financialRows: 0,
      reconciled: true,
    }),
  );
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
