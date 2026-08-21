#!/usr/bin/env node
/**
 * Provision a normal advertiser account for external product/compliance review.
 *
 * This is deliberately NOT an auth bypass or privileged reviewer role. It creates
 * the same `advertiser` user/profile shape used by self-service signup, marks the
 * mailbox verified so a reviewer can sign in immediately, and adds one inert
 * draft campaign + creative so the dashboard is useful on first login.
 *
 * No password or provider credential is stored in git. The password is read from
 * REVIEW_ACCOUNT_PASSWORD when supplied (for an approved deployment workflow),
 * otherwise from --password, otherwise from a hidden interactive prompt.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = require('@ateva/db');
const bcrypt = require('bcryptjs');
const { passwordValidationError } = require('@ateva/shared');

const BCRYPT_COST = 12;
const DEFAULT_NAME = 'External Reviewer';
const DEFAULT_COMPANY = 'Ateva Product Review';
const DEFAULT_COUNTRY = 'US';
const DEFAULT_WEBSITE = 'https://www.ateva.com';
const REVIEW_CAMPAIGN_NAME = 'Ateva product review — draft campaign';

function fail(message) {
  console.error(`bootstrap-review-advertiser: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const known = new Set(['--email', '--password', '--name', '--company', '--country', '--website']);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    // `pnpm run <script> -- --flag v` forwards the `--` separator itself, so a
    // strict parser rejects the very invocation the runbook documents. Skip it
    // rather than depend on a particular package-manager version.
    if (flag === '--') continue;
    if (!known.has(flag)) fail(`unknown argument "${flag}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`);
    out[flag.slice(2)] = value;
    i += 1;
  }
  return out;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (!['\n', '\r', '\u0004'].includes(String(char))) {
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

function newReferralCode() {
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function normalizeWebsite(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is required');

  const email = String(args.email ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('--email must be a valid email address');

  const envPassword = process.env.REVIEW_ACCOUNT_PASSWORD;
  const password = envPassword || args.password || (await promptHidden('Review account password (hidden): '));
  if (passwordValidationError(password)) {
    // Keep validation feedback intentionally generic: the password itself and
    // any validator-derived detail are credential-adjacent data and must never
    // be written to CI or operator logs.
    fail('password does not satisfy the Ateva password policy');
  }

  const name = String(args.name ?? DEFAULT_NAME).trim();
  const company = String(args.company ?? DEFAULT_COMPANY).trim();
  const country = String(args.country ?? DEFAULT_COUNTRY)
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fail('--country must be a two-letter ISO country code');

  const website = normalizeWebsite(String(args.website ?? DEFAULT_WEBSITE).trim());
  if (!website) fail('--website must be a public HTTPS URL');
  if (!name) fail('--name cannot be empty');
  if (!company) fail('--company cannot be empty');

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      fail(
        `a user with email ${email} already exists. Use a fresh review mailbox rather than overwriting an existing account.`,
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const created = await prisma.$transaction(async (tx) => {
      let referralCode;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = newReferralCode();
        const collision = await tx.user.findUnique({ where: { referralCode: candidate } });
        if (!collision) {
          referralCode = candidate;
          break;
        }
      }
      if (!referralCode) throw new Error('could not allocate a unique referral code');

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          role: 'advertiser',
          status: 'active',
          trustLevel: 'normal',
          country,
          emailVerified: true,
          referralCode,
        },
      });

      const advertiser = await tx.advertiser.create({
        data: {
          userId: user.id,
          companyName: company,
          billingEmail: email,
          websiteUrl: website,
          trustStatus: 'normal',
        },
      });

      const campaign = await tx.campaign.create({
        data: {
          advertiserId: advertiser.id,
          name: REVIEW_CAMPAIGN_NAME,
          status: 'draft',
          category: 'developer-tools',
          bidType: 'cpm',
          bidAmountMinor: 2000,
          budgetTotalMinor: 50000,
          currency: 'USD',
        },
      });

      await tx.adCreative.create({
        data: {
          campaignId: campaign.id,
          title: 'Example developer-tool campaign',
          sponsoredMessage: 'Review-only sample creative. This draft is not eligible to serve.',
          destinationUrl: `${website}/faq`,
          displayDomain: new URL(website).hostname,
          status: 'draft',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: 'advertiser',
          action: 'review_account.bootstrap',
          targetType: 'user',
          targetId: user.id,
          afterSnap: {
            email,
            role: 'advertiser',
            source: 'scripts/bootstrap-review-advertiser.mjs',
            campaignStatus: 'draft',
          },
        },
      });

      return { user, campaign };
    });

    console.log(
      [
        '',
        `✓ Review advertiser created: ${created.user.email}`,
        `✓ Draft campaign created: ${created.campaign.name}`,
        '',
        'Share only the deployed web login URL, the review email, and the password.',
        'Do not share DATABASE_URL, provider credentials, or operator/admin access.',
        '',
        'Expected product path:',
        '  /auth/login  →  /advertiser',
        '',
        'The sample campaign is draft-only and cannot serve by itself.',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/does not exist in the current database|P2021/.test(message)) {
    console.error(
      'bootstrap-review-advertiser: the database schema is not ready.\n' +
        'Run production migrations first, then retry the bootstrap command.',
    );
  } else {
    console.error(`bootstrap-review-advertiser: ${message}`);
  }
  process.exitCode = 1;
});
