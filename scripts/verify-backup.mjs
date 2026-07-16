#!/usr/bin/env node
/**
 * Verify a backup→restore cycle preserves data and financial invariants.
 *
 * This is the "demonstrably testable" proof required for DR readiness. It:
 *   1. Reads row counts + a financial invariant from a SOURCE database.
 *   2. Reads the same from a RESTORED database.
 *   3. Asserts they match exactly.
 *
 * The financial invariant: per-currency net advertiser spend must equal the sum
 * of net developer earnings + net platform fee + net fraud reserve (the same
 * reconciliation the money-integrity report computes). A restore that drops a
 * ledger row will fail this invariant even if overall row counts happen to match.
 *
 * Usage (run AFTER restore-db.sh has populated the target):
 *   node scripts/verify-backup.mjs
 *
 * Env:
 *   SOURCE_DATABASE_URL   required — the original/live DB
 *   RESTORED_DATABASE_URL required — the restored DB
 *
 * Exit: 0 = invariant preserved, 1 = mismatch/failed, 2 = config error.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(join(__dirname, '..', 'apps', 'api', 'package.json'));
const { PrismaClient, createPrismaAdapter } = apiRequire('@waitlayer/db');

const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const RESTORED_URL = process.env.RESTORED_DATABASE_URL;
if (!SOURCE_URL || !RESTORED_URL) {
  console.error('SOURCE_DATABASE_URL and RESTORED_DATABASE_URL are required');
  process.exit(2);
}

// Tables (by Prisma model name, camelCase) whose row counts must match exactly
// after a restore. Excludes time-sensitive/transient tables whose contents
// shift between backup and verify (sessions, rate-limit counters, cron leases).
const COUNTED_TABLES = [
  'user',
  'advertiser',
  'campaign',
  'adCreative',
  'device',
  'earningsLedger',
  'advertiserLedger',
  'platformLedger',
  'payoutRequest',
  'payoutAllocation',
  'payoutAccount',
  'adImpression',
  'adClick',
  'waitStateEvent',
  'referralReward',
  'recoveryDebtCase',
  'fraudFlag',
  'auditLog',
];

async function snapshot(url, label) {
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(url) });
  try {
    const counts = {};
    for (const table of COUNTED_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      counts[table] = await prisma[table].count();
    }
    // Financial invariant: per-currency net advertiser spend == net dev earnings
    // + net platform fee + net fraud reserve. Uses the same shape as the
    // money-integrity report's global reconciliation.
    const rows = await prisma.$queryRaw`
      WITH adv AS (
        SELECT "currency",
          SUM(CASE WHEN "entryType"='debit'  AND "status" IN ('confirmed','paid') THEN "amountMinor" ELSE 0 END)
        - SUM(CASE WHEN "entryType" IN ('refund','reversal') AND "status" IN ('confirmed','paid') THEN "amountMinor" ELSE 0 END) AS net
        FROM "advertiser_ledger" GROUP BY "currency"
      ),
      earn AS (
        SELECT "currency",
          SUM(CASE WHEN "entryType"='credit' AND "status" IN ('estimated','pending','confirmed','held','paid') THEN "amountMinor" ELSE 0 END)
        - SUM(CASE WHEN "entryType"='debit'  AND "status"='confirmed' THEN "amountMinor" ELSE 0 END) AS net
        FROM "earnings_ledger" GROUP BY "currency"
      ),
      fee AS (
        SELECT "currency",
          SUM(CASE WHEN "entryType"='credit'   AND "bucket"='platform_fee'  AND "status"='confirmed' THEN "amountMinor" ELSE 0 END)
        - SUM(CASE WHEN "entryType"='reversal' AND "bucket"='platform_fee'  AND "status"='confirmed' THEN "amountMinor" ELSE 0 END) AS net
        FROM "platform_ledger" GROUP BY "currency"
      ),
      res AS (
        SELECT "currency",
          SUM(CASE WHEN "entryType"='credit'   AND "bucket"='fraud_reserve' AND "status"='confirmed' THEN "amountMinor" ELSE 0 END)
        - SUM(CASE WHEN "entryType"='reversal' AND "bucket"='fraud_reserve' AND "status"='confirmed' THEN "amountMinor" ELSE 0 END) AS net
        FROM "platform_ledger" GROUP BY "currency"
      )
      SELECT a."currency", a.net AS "advNet", COALESCE(e.net,0) AS "earnNet",
             COALESCE(f.net,0) AS "feeNet", COALESCE(r.net,0) AS "resNet"
      FROM adv a
      LEFT JOIN earn e ON e."currency"=a."currency"
      LEFT JOIN fee f  ON f."currency"=a."currency"
      LEFT JOIN res r  ON r."currency"=a."currency"
    `;
    const invariant = {};
    for (const r of rows) {
      const adv = BigInt(r.advNet);
      const sum = BigInt(r.earnNet) + BigInt(r.feeNet) + BigInt(r.resNet);
      invariant[r.currency] = { advNet: adv.toString(), sum: sum.toString(), ok: adv === sum };
    }
    return { counts, invariant, label };
  } finally {
    await prisma.$disconnect();
  }
}

function diffCounts(src, dst) {
  const mismatches = [];
  for (const t of COUNTED_TABLES) {
    if (src.counts[t] !== dst.counts[t]) {
      mismatches.push(`${t}: source=${src.counts[t]} restored=${dst.counts[t]}`);
    }
  }
  return mismatches;
}

function diffInvariant(src, dst) {
  const mismatches = [];
  const currencies = new Set([...Object.keys(src.invariant), ...Object.keys(dst.invariant)]);
  for (const c of currencies) {
    const s = src.invariant[c];
    const d = dst.invariant[c];
    if (!s || !d) {
      mismatches.push(`${c}: ${s ? 'missing in restored' : 'missing in source'}`);
      continue;
    }
    if (s.advNet !== d.advNet || s.sum !== d.sum) {
      mismatches.push(`${c}: advNet source=${s.advNet} restored=${d.advNet}; sum source=${s.sum} restored=${d.sum}`);
    }
    if (!s.ok || !d.ok) {
      mismatches.push(`${c}: invariant not preserved (source ok=${s.ok}, restored ok=${d.ok})`);
    }
  }
  return mismatches;
}

async function main() {
  console.log('Snapshotting SOURCE database...');
  const src = await snapshot(SOURCE_URL, 'source');
  console.log('Snapshotting RESTORED database...');
  const dst = await snapshot(RESTORED_URL, 'restored');

  const countMismatches = diffCounts(src, dst);
  const invariantMismatches = diffInvariant(src, dst);

  if (countMismatches.length === 0 && invariantMismatches.length === 0) {
    console.log('\nBackup verification PASSED.');
    console.log('Row counts match for all %d tables.', COUNTED_TABLES.length);
    console.log('Financial invariant (per-currency net advertiser spend == earnings + fee + reserve) preserved.');
    process.exit(0);
  }

  if (countMismatches.length > 0) {
    console.error('\nRow count mismatches:');
    for (const m of countMismatches) console.error('  - ' + m);
  }
  if (invariantMismatches.length > 0) {
    console.error('\nFinancial invariant mismatches:');
    for (const m of invariantMismatches) console.error('  - ' + m);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
