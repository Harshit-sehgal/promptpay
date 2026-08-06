#!/usr/bin/env node
/**
 * Stamp the database environment marker (A-096).
 *
 * WHY THIS EXISTS
 * ---------------
 * `EnvironmentMarkerService.verify()` runs at API boot and refuses to start a
 * **production** deployment unless `environment_markers` row 1 already exists
 * and matches `WAITLAYER_ENVIRONMENT_KIND` / `WAITLAYER_ENVIRONMENT_ID`.
 * Non-production environments auto-create the row; production deliberately does
 * not, because auto-stamping would destroy the interlock it exists to provide —
 * an API accidentally pointed at a fresh or wrong database would cheerfully
 * claim it.
 *
 * That design is right. What was missing is a supported way to perform the act:
 * no seed, migration, script, or runbook created the row, so a fresh production
 * database could not boot the API at all. Discovered 2026-08-07 by actually
 * booting the production image:
 *
 *   BadRequestException: Database environment marker is missing for production
 *   environment production/<id>
 *
 * SAFETY
 * ------
 * Stamping a database is a claim about *which* database this is, so it is
 * deliberately explicit and non-idempotent-by-surprise:
 *   - requires `--confirm-stamp` so it can never run as a side effect;
 *   - refuses if a marker already exists with different values (that means you
 *     are pointed at another environment's database — the exact accident the
 *     interlock is for);
 *   - a matching existing marker is a no-op, so re-running during a redeploy
 *     is safe;
 *   - warns loudly when the target database already contains user rows, since
 *     stamping a populated database you did not expect is the dangerous case.
 *
 * USAGE
 *   DATABASE_URL=<url> WAITLAYER_ENVIRONMENT_KIND=production \
 *   WAITLAYER_ENVIRONMENT_ID=<id> \
 *     node scripts/bootstrap-environment-marker.mjs --confirm-stamp
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'package.json'),
);
const { PrismaClient, createPrismaAdapter } = require('@waitlayer/db');

const args = new Set(process.argv.slice(2));

function fail(message) {
  console.error(`bootstrap-environment-marker: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
const environmentKind = process.env.WAITLAYER_ENVIRONMENT_KIND;
const environmentId = process.env.WAITLAYER_ENVIRONMENT_ID;

if (!databaseUrl) fail('DATABASE_URL is required');
if (!environmentKind) fail('WAITLAYER_ENVIRONMENT_KIND is required');
if (!environmentId) fail('WAITLAYER_ENVIRONMENT_ID is required');
if (!args.has('--confirm-stamp')) {
  fail(
    'pass --confirm-stamp to claim this database as ' +
      `${environmentKind}/${environmentId}. This is a durable assertion about which ` +
      'database you are pointed at — do not automate it blindly.',
  );
}

const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

async function main() {
  const existing = await prisma.environmentMarker.findUnique({ where: { id: 1 } });

  if (existing) {
    if (existing.environmentKind === environmentKind && existing.environmentId === environmentId) {
      console.log(
        `✓ Environment marker already matches: ${existing.environmentKind}/${existing.environmentId} (no change)`,
      );
      return;
    }
    fail(
      `REFUSING TO OVERWRITE. This database is already marked ` +
        `${existing.environmentKind}/${existing.environmentId}, but you asked to stamp it as ` +
        `${environmentKind}/${environmentId}.\n` +
        '        You are almost certainly pointed at the wrong database — this is exactly the\n' +
        '        accident the environment-marker interlock exists to prevent. Verify\n' +
        '        DATABASE_URL before doing anything else.',
    );
  }

  // Stamping an already-populated database is the dangerous case: it usually
  // means DATABASE_URL points somewhere unintended. Surface it rather than
  // silently claiming someone else's data.
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.warn(
      `⚠  This database already contains ${userCount} user row(s) but has no environment ` +
        'marker. Confirm DATABASE_URL is the database you intend to claim.',
    );
  }

  await prisma.environmentMarker.create({
    data: { id: 1, environmentKind, environmentId },
  });
  console.log(`✓ Environment marker stamped: ${environmentKind}/${environmentId}`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    // Ordering guard: this script and bootstrap-admin both write to tables the
    // migrations create, so running either before `prisma migrate deploy`
    // surfaces a bare "table does not exist" that reads like a broken script.
    if (/does not exist in the current database|P2021/.test(message)) {
      console.error(
        'bootstrap-environment-marker: the database has no schema yet.\n' +
          '        Run migrations first, then re-run this:\n' +
          '          cd packages/db && prisma migrate deploy\n' +
          '        See docs/ops/deployment-checklist.md → cold-start order.',
      );
    } else {
      console.error(`bootstrap-environment-marker: ${message}`);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
