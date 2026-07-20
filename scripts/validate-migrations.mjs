#!/usr/bin/env node
/**
 * Standalone migration-validation gate for CI (P1 #13).
 *
 * Fails fast (exit 1) when the database schema has drifted from the applied
 * Prisma migrations or there are pending (unapplied) migrations. Mirrors
 * `apps/api/src/common/migration/*` so CI can run the check independently of
 * booting the API.
 *
 * Usage:  node scripts/validate-migrations.mjs
 * Needs DATABASE_URL in the environment (loads .env if present).
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const PRISMA_DIFF_NOT_EMPTY = 2;

// ── Minimal .env loader (dependency-free fallback for `dotenv`) ─────────────
// Only sets variables that are not already present so explicit env wins.
async function loadDotEnv() {
  try {
    const { config } = await import('dotenv');
    config();
    return;
  } catch {
    // dotenv not resolvable from here; fall through to the manual loader.
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// ── cwd-independent location of `packages/db` ───────────────────────────────
function resolveDbPackageDir() {
  let dir = process.cwd();
  for (;;) {
    const marker = path.join(dir, 'packages', 'db', 'prisma', 'schema.prisma');
    if (existsSync(marker)) return path.join(dir, 'packages', 'db');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), 'packages', 'db');
}

function execFileAsync(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        reject(error);
        return;
      }
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function runPrisma(args) {
  const cwd = resolveDbPackageDir();
  const tries = [
    ['prisma', args],
    ['pnpm', ['--filter', '@waitlayer/db', 'exec', 'prisma', ...args]],
  ];
  let lastErr;
  for (const [cmd, a] of tries) {
    try {
      return await execFileAsync(cmd, a, cwd);
    } catch (err) {
      lastErr = err;
      // ENOENT => binary not found; try the next strategy.
    }
  }
  throw new Error(
    'Could not locate the Prisma CLI (tried `prisma` on PATH and `pnpm --filter @waitlayer/db exec prisma`).',
    { cause: lastErr },
  );
}

async function getPending(schemaPath) {
  const { code, stdout } = await runPrisma(['migrate', 'status', '--schema', schemaPath]);
  if (code === 0) return [];
  const match = stdout.match(/have not yet been applied:\s*\n([\s\S]*?)(?:\n\n|$)/);
  if (match) {
    return match[1].split('\n').map((s) => s.trim()).filter(Boolean);
  }
  // Could not determine pending cleanly (e.g. histories diverge). Surface as a
  // failure so CI never silently passes an unverifiable database.
  throw new Error(`prisma migrate status failed (exit ${code}):\n${stdout}`);
}

async function getDrift(schemaPath) {
  const { code, stdout, stderr } = await runPrisma([
    'migrate',
    'diff',
    '--exit-code',
    '--from-config-datasource',
    '--to-schema',
    schemaPath,
  ]);
  if (code === 0) return { drift: false };
  if (code === PRISMA_DIFF_NOT_EMPTY) {
    const detail = `${stdout}${stderr}`.trim() || 'schema differs from the migration history';
    return { drift: true, detail };
  }
  const detail = `${stdout}${stderr}`.trim() || 'prisma migrate diff failed';
  throw new Error(`Could not determine schema drift: ${detail}`);
}

async function main() {
  loadDotEnv();

  if (!process.env.DATABASE_URL) {
    console.error('[migration-validation] DATABASE_URL is not set; cannot validate migrations.');
    process.exit(1);
  }

  const dbDir = resolveDbPackageDir();
  const schemaPath = process.env.MIGRATION_SCHEMA ?? path.join(dbDir, 'prisma', 'schema.prisma');

  const pending = await getPending(schemaPath);
  const { drift, detail } = await getDrift(schemaPath);
  // A non-empty diff while migrations are pending is expected (the live DB simply
  // has not reached the datamodel yet), so drift is only fatal with no pending.
  const effectiveDrift = drift && pending.length === 0;

  if (pending.length > 0 || effectiveDrift) {
    console.error('[migration-validation] Database is not in sync with migrations:');
    if (effectiveDrift) console.error('  - schema drift detected');
    if (pending.length > 0) {
      console.error(`  - unapplied migrations: ${pending.join(', ')}`);
    }
    if (detail) console.error(detail);
    console.error("Run 'pnpm --filter @waitlayer/db exec prisma migrate deploy' before starting.");
    process.exit(1);
  }

  console.log('[migration-validation] Database schema is in sync with migrations.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[migration-validation] ${err?.stack ?? err}`);
  process.exit(1);
});
