// Machine-checks the key claims documented in AGENTS.md so the audit narrative
// cannot silently drift from the code. Run in CI (verify-audit-claims job) and
// locally via `node scripts/audit-claims.mjs`. No dependencies — Node built-ins
// only, so it runs without pnpm install.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) throw new Error(`MISSING FILE: ${rel}`);
  return readFileSync(p, 'utf8');
}

const checks = [];
function check(name, cond) {
  checks.push({ name, ok: !!cond });
}

// A-075: Docker image runs as non-root.
const dockerfile = read('Dockerfile');
// Assert against INSTRUCTIONS, never the prose around them. The prisma pin
// below used to be checked against the raw file and silently went vacuous:
// the global `npm install -g prisma@7.9.0` was removed, but a comment
// explaining the removal still contained the string, so the claim kept
// passing while verifying nothing. Negative assertions have the mirror-image
// problem — a comment mentioning `ARG JWT_SECRET` would fail them for no
// reason. Both directions are fixed by stripping comments first.
const dockerfileLive = dockerfile
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
check('Dockerfile runs as non-root (USER node)', /^\s*USER node\b/m.test(dockerfileLive));
check(
  'Docker build tools are version pinned and JWT signing secrets are not build args',
  dockerfileLive.includes('ARG PNPM_VERSION=11.9.0') &&
    dockerfileLive.includes('pnpm@${PNPM_VERSION}') &&
    !dockerfileLive.includes('ARG JWT_SECRET') &&
    !dockerfileLive.includes('ENV JWT_SECRET='),
);
// The Prisma CLI is no longer pinned in the Dockerfile at all — it is a
// production dependency of packages/db, resolved through the committed
// lockfile and installed with --frozen-lockfile. That is the real mechanism,
// so that is what gets checked.
const dbPkg = JSON.parse(read('packages/db/package.json'));
const lockfile = read('pnpm-lock.yaml');
check(
  'Prisma CLI is pinned through the lockfile, not a global install',
  Boolean(dbPkg.dependencies?.prisma) &&
    !dbPkg.devDependencies?.prisma &&
    /^\s+prisma:\n\s+specifier: [^\n]+\n\s+version: 7\./m.test(lockfile) &&
    !/^\s*RUN[^\n]*npm install -g[^\n]*prisma/m.test(dockerfileLive) &&
    dockerfileLive.includes('--frozen-lockfile'),
);

// The migration count in AGENTS.md is prose, and prose drifts. It has now gone
// stale twice (91 -> 94, then 94 -> 95 when the ad-opportunity hot-path index
// landed), each time sending a reader to a number that is simply wrong. Rather
// than correct it a third time, tie it to the filesystem.
const migrationDirs = readdirSync(resolve(ROOT, 'packages/db/prisma/migrations')).filter(
  (entry) => entry !== 'migration_lock.toml',
);
const statusCount = /- \*\*(\d+) migrations\.\*\*/.exec(read('AGENTS.md'));
check(
  `AGENTS.md states the real migration count (${migrationDirs.length})`,
  Boolean(statusCount) && Number(statusCount[1]) === migrationDirs.length,
);

// A-018: web CSP allows the Google Identity frame-src.
const nextConfig = read('apps/web/next.config.js');
check(
  'web CSP frame-src allows accounts.google.com (A-018)',
  nextConfig.includes("frame-src 'self' https://accounts.google.com"),
);

// A-030: payout provider launch-status gate exists in shared + API.
const payoutProviders = read('packages/shared/src/payout-providers.ts');
check(
  'shared exports applyPayoutProviderOverrides (A-030 web gate)',
  payoutProviders.includes('applyPayoutProviderOverrides'),
);
check(
  'shared exports payoutProviderLaunchStatus (A-030)',
  payoutProviders.includes('payoutProviderLaunchStatus'),
);

const payoutMethod = read('apps/api/src/payout/payout-method.trait.ts');
check(
  'API rejects coming_soon payout provider at registration (A-030 server gate)',
  payoutMethod.includes('payoutProviderLaunchStatus') &&
    /launch status: coming_soon/.test(payoutMethod),
);

// CI guards the standalone-404 bug class (compiled API must serve routes).
const ci = read('.github/workflows/ci.yml');
check(
  'CI docker-build requires the compiled login route to return validation status 400',
  ci.includes('if [ "$STATUS" != "400" ]') &&
    ci.includes('Unexpected login validation status') &&
    ci.includes('/api/v1/auth/login'),
);
check(
  'CI runs the dependency-free release-input regression tests',
  read('package.json').includes('test:release-gates') &&
    read('scripts/validate-release-inputs.test.mjs').includes('reference attester'),
);

const stagingWorkflow = read('.github/workflows/staging.yml');
check(
  'staging rejects the reference attester and production promotion requires immutable digests',
  stagingWorkflow.includes('validate-release-inputs.mjs') &&
    stagingWorkflow.includes('validate-release-inputs.mjs --promotion'),
);

// Workflow actions execute third-party code with repository context. Require
// immutable commit pins in every workflow; readable `# vN` comments preserve
// upgrade context without trusting a mutable tag at runtime.
const workflowDir = resolve(ROOT, '.github/workflows');
const mutableActionRefs = readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .flatMap((name) => {
    const source = read(`.github/workflows/${name}`);
    return [...source.matchAll(/\buses:\s*[^\s@]+@([^\s#]+)/g)]
      .map((match) => match[1])
      .filter((ref) => !/^[0-9a-f]{40}$/.test(ref))
      .map((ref) => `${name}:${ref}`);
  });
check('GitHub Actions are pinned to immutable commit SHAs', mutableActionRefs.length === 0);

const workspaceConfig = read('pnpm-workspace.yaml');
check(
  'pnpm supply-chain quarantine and blocked Scarf install telemetry stay enabled',
  /minimumReleaseAge:\s*1440\b/.test(workspaceConfig) &&
    /'@scarf\/scarf':\s*false\b/.test(workspaceConfig),
);
check(
  'stale audited Hono server override remains removed after the dependency upgrade',
  !workspaceConfig.includes('@hono/node-server'),
);

// The product is Ateva. The rename left `@waitlayer/*` names lingering in
// untracked build artifacts (apps/web/.vercel/node/package-manifest.json still
// listed them long after the source moved), which shows this drift class can
// survive invisibly in generated files. The tracked source of truth must not
// drift the same way: every workspace manifest carries the Ateva identity, so
// a future package cannot silently revive the old scope.
const workspacePackageDirs = ['apps', 'packages', 'tools'].flatMap((dir) =>
  readdirSync(resolve(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}`),
);
const nonAtevaPackages = workspacePackageDirs.filter((dir) => {
  try {
    return !/^(@ateva\/|ateva-)/.test(JSON.parse(read(`${dir}/package.json`)).name);
  } catch {
    return true; // a workspace directory without a readable manifest is itself drift
  }
});
check('every workspace package name carries the Ateva identity', nonAtevaPackages.length === 0);

// `.e2e/run-e2e.sh` hardcoded this checkout's absolute path at BOTH of its
// `cd` sites, so the dev browser-e2e runner only worked from one machine's
// clone layout (run-e2e-production.sh already derived its root correctly).
// The runners must derive the checkout root from their own location; a
// hardcoded `/home/...` cd is exactly how that regression returns.
const e2eRunners = ['.e2e/run-e2e.sh', '.e2e/run-e2e-production.sh'];
check(
  'e2e runners derive the checkout root instead of hardcoding an absolute path',
  e2eRunners.every((script) => !/cd\s+"?\/home\//.test(read(script))),
);

// Runtime fixtures and operator templates must not exercise domains the
// project does not own. Historical documents, test-only fixtures, and the
// deliberate production rejection checks are excluded here because they
// describe or simulate those boundaries rather than sending users there.
const activeDomainFiles = [
  '.env.example',
  'packages/db/prisma/seed.ts',
  'scripts/seed-dr-data.mjs',
  'scripts/enforce-health-metrics.mjs',
  'scripts/scaffold-production-env.mjs',
  'apps/api/src/common/utils/account-erasure.ts',
];
const unownedDomain = /\bateva\.(?:com|dev)\b/i;
const staleDomainFiles = activeDomainFiles.filter((file) => unownedDomain.test(read(file)));
check(
  'active fixtures and templates do not exercise unowned project domains',
  staleDomainFiles.length === 0,
);

// AGENTS.md reflects the CI-guarded correction (narrative tied to the guard).
const agents = read('AGENTS.md');
check(
  'AGENTS.md documents the CI controller-route guard',
  agents.includes('`docker-build` CI job now boots') && agents.includes('compiled API image'),
);

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
}

if (failed) {
  console.error(`\n${failed} audit claim(s) FAILED — AGENTS.md has drifted from code.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} audit claims PASS — AGENTS.md matches code.`);
