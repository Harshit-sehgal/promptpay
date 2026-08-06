#!/usr/bin/env node
/**
 * Create the first WaitLayer administrator (A-088).
 *
 * WHY THIS EXISTS
 * ---------------
 * Signup refuses privileged roles by design — `SignUpDto.role` accepts only
 * `developer` and `advertiser` ("privileged roles cannot be self-assigned").
 * Nothing else in the codebase creates an `admin`/`super_admin`: not a seed,
 * not a migration, not an endpoint. On a fresh production database that means
 * nobody can approve a campaign, flip any of the five fail-closed money
 * switches, verify a payout account, or process a payout. The product boots
 * inert and stays that way.
 *
 * This script closes exactly that gap and nothing more. It is deliberately a
 * one-shot: once any administrator exists, it refuses to run, so it cannot
 * become a backdoor that quietly mints privilege later in the product's life.
 * Subsequent admins are promoted by an existing admin through the product.
 *
 * SAFETY MODEL
 * ------------
 *   1. Requires `ADMIN_BOOTSTRAP_TOKEN` in the environment AND a matching
 *      `--token` argument, compared in constant time. Possession of the
 *      database URL alone is not sufficient.
 *   2. Refuses if any admin/super_admin already exists.
 *   3. Enforces the same password rules as the public signup path, reusing
 *      `passwordValidationError` from @waitlayer/shared — one source of truth.
 *   4. Hashes with bcrypt cost 12, identical to `auth-core.trait.ts`.
 *   5. Writes an `audit_logs` row in the same transaction as the user, so the
 *      creation of the most privileged account in the system cannot succeed
 *      unaudited.
 *   6. Never echoes or logs the password.
 *
 * USAGE
 * -----
 *   ADMIN_BOOTSTRAP_TOKEN=<secret> DATABASE_URL=<url> \
 *     node scripts/bootstrap-admin.mjs \
 *       --token <secret> --email ops@example.com --password '<password>'
 *
 * Omit --password to be prompted interactively (input is not echoed), which
 * keeps the password out of your shell history and the process table.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = require('@waitlayer/db');
const bcrypt = require('bcryptjs');
const { passwordValidationError, PASSWORD_RULES } = require('@waitlayer/shared');

const BCRYPT_COST = 12;
const ADMIN_ROLE = 'super_admin';

function fail(message) {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

/** Parse `--flag value` pairs. Unknown flags are rejected rather than ignored. */
function parseArgs(argv) {
  const known = new Set(['--token', '--email', '--password', '--name']);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!known.has(flag)) fail(`unknown argument "${flag}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`);
    out[flag.slice(2)] = value;
    i += 1;
  }
  return out;
}

/** Length-independent constant-time comparison. */
function secretsMatch(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) {
    // Still burn a comparison so a length mismatch is not measurably faster.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      // Redraw the prompt without the typed characters.
      if (!['\n', '\r', ''].includes(String(char))) {
        process.stdout.write(`\r\x1b[2K${question}`);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/**
 * Referral codes are `@unique`; the signup path retries on collision. Mirror
 * that here rather than assuming a single attempt succeeds.
 */
function newReferralCode() {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const expectedToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expectedToken || expectedToken.length < 16) {
    fail(
      'ADMIN_BOOTSTRAP_TOKEN must be set to a secret of at least 16 characters ' +
        '(store it in your secret manager, not in a file).',
    );
  }
  if (!args.token) fail('pass --token <ADMIN_BOOTSTRAP_TOKEN> to confirm this action');
  if (!secretsMatch(args.token, expectedToken)) fail('token mismatch');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is required');

  const email = String(args.email ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('--email must be a valid email address');

  const password = args.password ?? (await promptHidden('Administrator password (hidden): '));
  const passwordError = passwordValidationError(password);
  if (passwordError) fail(`password rejected — ${passwordError}\n${PASSWORD_RULES}`);

  const name = args.name ? String(args.name).trim() : 'Administrator';

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    // One-shot guard. Checked before hashing so a re-run is cheap, and again
    // inside the transaction so two concurrent runs cannot both win.
    const existing = await prisma.user.findFirst({
      where: { role: { in: ['admin', 'super_admin'] } },
      select: { email: true, role: true },
    });
    if (existing) {
      fail(
        `an administrator already exists (${existing.role}). This script is one-shot by ` +
          'design; promote further admins through the product with an existing admin account.',
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const created = await prisma.$transaction(async (tx) => {
      const racedAdmin = await tx.user.findFirst({
        where: { role: { in: ['admin', 'super_admin'] } },
        select: { id: true },
      });
      if (racedAdmin) throw new Error('an administrator was created concurrently; aborting');

      let user;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          user = await tx.user.create({
            data: {
              email,
              passwordHash,
              name,
              role: ADMIN_ROLE,
              status: 'active',
              // The operator controls this mailbox by definition — they hold the
              // bootstrap token. Requiring a verification email here would make
              // the very first login depend on outbound mail being configured.
              emailVerified: true,
              referralCode: newReferralCode(),
            },
          });
          break;
        } catch (error) {
          if (error?.code === 'P2002' && String(error?.meta?.target ?? '').includes('referral')) {
            continue;
          }
          if (error?.code === 'P2002') {
            throw new Error(`a user with email ${email} already exists`);
          }
          throw error;
        }
      }
      if (!user) throw new Error('could not allocate a unique referral code');

      await tx.adminUser.create({
        data: { userId: user.id, adminRole: ADMIN_ROLE, permissions: [] },
      });

      // Written inside the transaction on purpose: creating the most
      // privileged account in the system must not be able to commit without
      // its audit record. Mirrors `audit.logStrict(..., tx)` in the API.
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: ADMIN_ROLE,
          targetType: 'user',
          targetId: user.id,
          action: 'admin.bootstrap',
          afterSnap: { email, role: ADMIN_ROLE, source: 'scripts/bootstrap-admin.mjs' },
        },
      });

      return user;
    });

    console.log(
      [
        '',
        `✓ Administrator created: ${created.email} (${ADMIN_ROLE})`,
        '',
        'Required next steps — the account cannot do anything yet:',
        '',
        '  1. Sign in and enrol TOTP two-factor authentication.',
        '     In production, AdminMfaStepUpGuard rejects every admin POST/PUT/PATCH/DELETE',
        '     unless twoFactorEnabled is set AND the MFA is recent',
        '     (ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS, default 600s). Without this you will',
        '     get 403 "Recent two-factor authentication is required" on every action.',
        '',
        '  2. Rotate ADMIN_BOOTSTRAP_TOKEN out of the environment. It has served its',
        '     purpose and this script will refuse to run again regardless.',
        '',
        '  3. The five money switches remain fail-closed until you enable them',
        '     (admin → settings): ads.global, wait.earnings, deposits.global,',
        '     payouts.requests, payouts.auto. Leave them off until each rail is',
        '     credential-verified; see docs/ops/deployment-checklist.md.',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // Ordering guard — see bootstrap-environment-marker.mjs. Running this before
  // `prisma migrate deploy` otherwise surfaces a bare "table does not exist".
  if (/does not exist in the current database|P2021/.test(message)) {
    console.error(
      'bootstrap-admin: the database has no schema yet.\n' +
        '        Run migrations first, then re-run this:\n' +
        '          cd packages/db && prisma migrate deploy\n' +
        '        See docs/ops/deployment-checklist.md → cold-start order.',
    );
  } else {
    console.error(`bootstrap-admin: ${message}`);
  }
  process.exitCode = 1;
});
