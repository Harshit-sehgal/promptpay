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
check('Dockerfile runs as non-root (USER node)', /^\s*USER node\b/m.test(dockerfile));
check(
  'Docker build tools are exact-version pinned and JWT signing secrets are not build args',
  dockerfile.includes('pnpm@11.9.0') &&
    dockerfile.includes('prisma@7.8.0') &&
    !dockerfile.includes('ARG JWT_SECRET') &&
    !dockerfile.includes('ENV JWT_SECRET='),
);

// A-018: web CSP allows the Google Identity frame-src.
const nextConfig = read('apps/web/next.config.js');
check(
  "web CSP frame-src allows accounts.google.com (A-018)",
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
  ci.includes("if [ \"$STATUS\" != \"400\" ]") &&
    ci.includes('Unexpected login validation status') &&
    ci.includes('/api/v1/auth/login'),
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

// AGENTS.md reflects the CI-guarded correction (narrative tied to the guard).
const agents = read('AGENTS.md');
check(
  'AGENTS.md documents the CI controller-route guard',
  agents.includes('CI job now boots the compiled API image'),
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
