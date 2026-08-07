#!/usr/bin/env node
/**
 * Guarantee the Prisma schema engine binary is present, at BUILD time.
 *
 * `@prisma/engines` does NOT ship the engine in its npm tarball — its
 * `files` field is `["dist","download","scripts"]` and the ~22 MB
 * `schema-engine-<platform>` binary is fetched by its `postinstall` script.
 * The runtime image installs with `--ignore-scripts`, so that postinstall
 * never runs and the binary is absent from the image.
 *
 * Prisma then downloads it lazily on FIRST USE. Verified by hiding the local
 * binary and running `prisma migrate status`: it silently re-downloaded all
 * 22 MB before doing anything. In a container that first use is
 * `prisma migrate deploy` in the entrypoint, so every single container start
 * pulled 22 MB from Prisma's CDN before the app could boot:
 *
 *   - cold start went from ~8s to 46s on a good run;
 *   - on a slower run the container never passed its healthcheck at all
 *     (272s of failing probes, then "dependency failed to start");
 *   - and on a host with no egress to Prisma's binary CDN — a perfectly
 *     ordinary production posture — the container could never start.
 *
 * So this runs the fetch once, during the build, and then ASSERTS the binary
 * is there. A build that cannot produce a self-contained image must fail
 * loudly here rather than produce an image that only boots on a machine with
 * internet access.
 *
 * Resolution walks packages/db → prisma → @prisma/engines through Node's own
 * resolver rather than guessing a path: pnpm's store layout is content-
 * addressed and must never be hardcoded.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Engine binaries are named `schema-engine-<platform>`, e.g. `-linux-musl-openssl-3.0.x`. */
export const ENGINE_PREFIX = 'schema-engine-';

export function resolveEnginesDir(root = ROOT) {
  const fromDb = createRequire(join(root, 'packages/db/package.json'));
  const fromPrisma = createRequire(fromDb.resolve('prisma/package.json'));
  return dirname(fromPrisma.resolve('@prisma/engines/package.json'));
}

export function foundEngines(dir) {
  return readdirSync(dir).filter((name) => name.startsWith(ENGINE_PREFIX));
}

function main() {
  const dir = resolveEnginesDir();

  let engines = foundEngines(dir);
  if (engines.length > 0) {
    console.log(`Prisma schema engine already present: ${engines.join(', ')}`);
    return;
  }

  const postinstall = join(dir, 'scripts', 'postinstall.js');
  if (!existsSync(postinstall)) {
    console.error(`No schema engine and no postinstall script at ${postinstall}.`);
    process.exit(1);
  }

  console.log('Prisma schema engine missing — fetching it now, at build time.');
  execFileSync(process.execPath, [postinstall], { cwd: dir, stdio: 'inherit' });

  engines = foundEngines(dir);
  if (engines.length === 0) {
    console.error(
      `Prisma schema engine still missing in ${dir} after running its postinstall.\n` +
        'Refusing to produce an image that would download it on every container start\n' +
        '(and fail outright on a host without egress to Prisma\'s CDN).',
    );
    process.exit(1);
  }
  console.log(`Prisma schema engine fetched: ${engines.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
