import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// Resolve from the api package so workspace symlinks work (same as the script).
const requireDb = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = requireDb('@ateva/db');

const root = resolve(import.meta.dirname, '..');
const dbUrl = process.env.ERASURE_TEST_DATABASE_URL ?? 'postgresql://ateva:ateva-test@localhost:5433/ateva_test?schema=public';
const SCRIPT = resolve(root, 'scripts/erase-waitlist-signup.mjs');

/**
 * GDPR erasure for waitlist signups against a real database: the script must
 * delete the row AND scrub the audit trail in one transaction, and must
 * refuse to run without --confirm-production under NODE_ENV=production.
 */
test('erase-waitlist-signup deletes the row and scrubs the audit trail', async (t) => {
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(dbUrl) });
  const email = `erasure-${randomUUID()}@ateva.test`;

  await prisma.advertiserWaitlist.create({
    data: { email, consent: true, company: 'Erasure Co' },
  });
  const row = await prisma.advertiserWaitlist.findUnique({ where: { email } });
  assert.ok(row, 'fixture row must exist');
  await prisma.auditLog.create({
    data: {
      actorId: 'anonymous',
      actorRole: 'anonymous',
      action: 'advertiser_waitlist_created',
      targetType: 'advertiser_waitlist',
      targetId: row.id,
      afterSnap: { hasEmail: true },
      ipHash: 'deadbeef',
    },
  });

  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { targetType: 'advertiser_waitlist' } });
    await prisma.advertiserWaitlist.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  const out = execFileSync('node', [SCRIPT, '--email', email], {
    env: { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  assert.match(out, /1 row deleted, 1 audit entr/);

  assert.equal(await prisma.advertiserWaitlist.count({ where: { email } }), 0, 'row deleted');
  const audit = await prisma.auditLog.findFirst({
    where: { targetType: 'advertiser_waitlist', targetId: row.id },
  });
  assert.ok(audit, 'audit row retained as de-identified fact');
  assert.equal(audit.afterSnap, null, 'afterSnap scrubbed');
  assert.equal(audit.ipHash, null, 'ipHash scrubbed');
});

test('erase-waitlist-signup refuses production without --confirm-production', () => {
  assert.throws(
    () =>
      execFileSync('node', [SCRIPT, '--email', 'x@y.test'], {
        env: { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'production' },
        encoding: 'utf8',
      }),
    /Refusing to erase on a production NODE_ENV/,
  );
});

test('erase-waitlist-signup exits 0 cleanly for an unknown email', async () => {
  const out = execFileSync('node', [SCRIPT, '--email', 'nobody@ateva.test'], {
    env: { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  assert.match(out, /nothing to erase/);
});