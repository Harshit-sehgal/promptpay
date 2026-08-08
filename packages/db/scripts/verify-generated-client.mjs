#!/usr/bin/env node
/**
 * Assert that `prisma generate` actually produced a usable client.
 *
 * `prisma generate` can exit 0 having written a client that exports nothing.
 * Observed 2026-08-08: the `docker-build` job's generate step reported success
 * and typecheck then failed with 40+ errors of the form
 *
 *   Module '"@prisma/client"' has no exported member 'PrismaClient'
 *
 * Eight CI jobs run that same generate step, so the failure surfaces far from
 * its cause, in whichever job happens to compile first, as a wall of type
 * errors that look like a source problem rather than a generation problem.
 *
 * This runs as part of `pnpm --filter @waitlayer/db generate`, so every caller —
 * CI, local development and the Docker build — gets the check for free, and a
 * partial generation fails loudly at the step that caused it.
 */
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

/** A model class, an enum, and a namespace — a partial client loses these first. */
const REQUIRED_EXPORTS = ['PrismaClient', 'Prisma'];

let client;
try {
  client = require('@prisma/client');
} catch (error) {
  console.error(
    `prisma generate reported success but @prisma/client cannot be loaded:\n  ${error.message}`,
  );
  process.exit(1);
}

const missing = REQUIRED_EXPORTS.filter((name) => client[name] === undefined);
if (missing.length > 0) {
  console.error(
    `prisma generate reported success but the client is incomplete.\n` +
      `  Missing exports: ${missing.join(', ')}\n` +
      `  This is a generation failure, not a source error. Re-run\n` +
      `  \`pnpm --filter @waitlayer/db generate\` and check that the Prisma\n` +
      `  engines are present (see scripts/ensure-prisma-engines.mjs).`,
  );
  process.exit(1);
}

// The client is only useful if it carries the schema's models. `Prisma.dmmf`
// is the generated model metadata; an empty one means the schema was not read.
const modelCount = client.Prisma?.dmmf?.datamodel?.models?.length ?? 0;
if (modelCount === 0) {
  console.error(
    'prisma generate produced a client with no models — the schema was not read.',
  );
  process.exit(1);
}

console.log(`Prisma client verified: ${modelCount} models, exports present.`);
