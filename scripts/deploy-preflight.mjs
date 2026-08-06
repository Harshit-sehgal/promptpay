#!/usr/bin/env node
/**
 * Production deploy preflight (A-094).
 *
 * One command an operator runs on the deploy host *before* bringing a release
 * up. It answers the question the existing gates cannot: "is THIS environment
 * actually safe to serve real users from?" Typecheck, lint, and unit tests all
 * pass on a machine that has no database, no secrets, and a development
 * compose override sitting in the working directory.
 *
 * Every check fails closed. Exit code 0 means every FAIL-level check passed;
 * WARN-level findings are printed but do not block, because they are judgement
 * calls an operator may legitimately override.
 *
 *   node scripts/deploy-preflight.mjs            # env + config checks only
 *   node scripts/deploy-preflight.mjs --with-db  # also probe Postgres/Redis
 *
 * Deliberately dependency-free apart from the workspace packages it validates
 * against, so it can run on a bare deploy host before an image build.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const withDb = args.has('--with-db');

let results = [];
const ok = (name, detail) => results.push({ level: 'PASS', name, detail });
const warn = (name, detail) => results.push({ level: 'WARN', name, detail });
const fail = (name, detail) => results.push({ level: 'FAIL', name, detail });

/**
 * Run the pure (no-I/O-beyond-the-override-file) checks and return findings.
 * Exported so the release-gate tests can prove these checks actually fire —
 * a preflight that cannot fail is worse than none, because it manufactures
 * confidence.
 */
export function evaluateEnvironment(env, { skipComposeCheck = false } = {}) {
  results = [];
  if (!skipComposeCheck) checkComposeOverride();
  checkEnvironment(env);
  checkAttestation(env);
  return results;
}

export const hasFailure = (findings) => findings.some((r) => r.level === 'FAIL');
export const findingFor = (findings, name) => findings.find((r) => r.name === name);

// ── 1. The dev-compose override trap (A-093) ────────────────────────────────
// `docker compose` auto-loads docker-compose.override.yml from the working
// directory. That file is committed, is development-only, and silently
// switches both services to the `build` stage with NODE_ENV=development and
// mock Google auth ENABLED. A bare `docker compose up` on a deploy host
// therefore serves a dev server with mock authentication to the public.
function checkComposeOverride() {
  const override = join(ROOT, 'docker-compose.override.yml');
  if (!existsSync(override)) {
    ok('compose-override', 'no auto-loaded dev override present');
    return;
  }
  let body = '';
  try {
    body = readFileSync(override, 'utf8');
  } catch {
    /* unreadable is handled below */
  }
  const dangerous =
    body.includes('target: build') ||
    body.includes('MOCK_GOOGLE_ENABLED') ||
    body.includes('NODE_ENV: development');
  if (dangerous) {
    fail(
      'compose-override',
      'docker-compose.override.yml is present and is DEVELOPMENT-ONLY (target: build, ' +
        'NODE_ENV=development, mock Google auth on). `docker compose` auto-loads it. ' +
        'Deploy with an explicit file instead:\n' +
        '        docker compose --env-file .env.production \\\n' +
        '          -f docs/ops/docker-compose.images.example.yml up -d\n' +
        '        …or remove the override from the deploy host entirely.',
    );
    return;
  }
  warn('compose-override', 'an override file exists; confirm it is production-safe');
}

// ── 2. Required production environment ──────────────────────────────────────
function checkEnvironment(env) {
  if (env.NODE_ENV !== 'production') {
    fail('node-env', `NODE_ENV is "${env.NODE_ENV ?? 'unset'}", expected "production"`);
  } else {
    ok('node-env', 'production');
  }

  // Validate against the real schema so this never drifts from the API's own
  // boot-time requirements.
  try {
    const require = createRequire(join(ROOT, 'apps', 'api', 'package.json'));
    const { loadEnv } = require('@waitlayer/config');
    loadEnv(env);
    ok('config-schema', '@waitlayer/config accepted the environment');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail('config-schema', message.split('\n').slice(0, 12).join('\n        '));
  }

  // Explicitly re-check the switches that are easy to get wrong and expensive
  // to get wrong, even though the schema covers most of them.
  if (env.COOKIE_SECURE === 'false') {
    fail('cookie-secure', 'COOKIE_SECURE=false is never permitted in production');
  } else {
    ok('cookie-secure', 'not disabled');
  }

  const mockFlags = ['ALLOW_MOCK_GOOGLE', 'MOCK_GOOGLE_ENABLED', 'NEXT_PUBLIC_ALLOW_MOCK_AUTH']
    .filter((key) => ['true', '1'].includes(String(env[key] ?? '').toLowerCase()))
    .map((key) => `${key}=${env[key]}`);
  if (mockFlags.length > 0) {
    fail('mock-auth', `${mockFlags.join(', ')} — mock authentication must be OFF in production`);
  } else {
    ok('mock-auth', 'no mock authentication flags enabled');
  }

  // Throttle overrides exist for isolated CI/test APIs. On a public production
  // API they silently remove the abuse controls.
  const throttles = Object.keys(env).filter((k) => k.startsWith('THROTTLE_'));
  if (throttles.length > 0) {
    fail(
      'throttle-overrides',
      `${throttles.join(', ')} set — these are test-only overrides and must never be present ` +
        'on a public production API',
    );
  } else {
    ok('throttle-overrides', 'none set');
  }

  // The web BFF signs identity headers with JWT_SECRET; it must equal the API's.
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    fail('jwt-secret', 'JWT_SECRET must be at least 32 characters');
  }
}

// ── 3. Attestation posture ──────────────────────────────────────────────────
// Settlement must not be reachable without a genuinely independent issuer.
function checkAttestation(env) {
  const issuers = env.WAIT_ATTESTATION_ISSUERS;
  if (!issuers) {
    ok('attestation', 'no issuer configured — settlement stays fail-closed (expected pre-launch)');
    return;
  }
  if (/waitlayer-stub-bridge|stub-v1/i.test(issuers)) {
    fail(
      'attestation',
      'WAIT_ATTESTATION_ISSUERS references the reference/stub bridge. It is prohibited for ' +
        'public rewards — see docs/ops/wait-attestation-launch-gate.md',
    );
    return;
  }
  warn('attestation', 'a real issuer is configured; confirm the launch-gate experiment passed');
}

// ── 4. Live infrastructure + operator readiness ─────────────────────────────
async function checkDatabase(env) {
  const require = createRequire(join(ROOT, 'apps', 'api', 'package.json'));
  const { PrismaClient, createPrismaAdapter } = require('@waitlayer/db');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(env.DATABASE_URL) });
  try {
    await prisma.$queryRaw`SELECT 1`;
    ok('database', 'reachable');

    const pending = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL`;
    const n = Array.isArray(pending) ? (pending[0]?.n ?? 0) : 0;
    if (n > 0) fail('migrations', `${n} migration(s) not finished — resolve before serving`);
    else ok('migrations', 'no unfinished migrations');

    // A-088: without an administrator the deployment is inert — no campaign can
    // be approved and no money switch can be flipped.
    const admins = await prisma.user.count({
      where: { role: { in: ['admin', 'super_admin'] }, status: 'active' },
    });
    if (admins === 0) {
      fail(
        'administrator',
        'no active admin/super_admin exists. The deployment will boot inert. Run:\n' +
          '        ADMIN_BOOTSTRAP_TOKEN=<secret> pnpm bootstrap:admin --token <secret> --email <you>',
      );
    } else {
      ok('administrator', `${admins} active administrator(s)`);
      const withMfa = await prisma.user.count({
        where: {
          role: { in: ['admin', 'super_admin'] },
          status: 'active',
          twoFactorEnabled: true,
        },
      });
      if (withMfa === 0) {
        fail(
          'administrator-mfa',
          'no administrator has TOTP enrolled. AdminMfaStepUpGuard rejects every admin ' +
            'write in production, so nobody can approve a campaign or flip a switch.',
        );
      } else {
        ok('administrator-mfa', `${withMfa} administrator(s) with 2FA`);
      }
    }

    // Report the money switches rather than judging them: leaving them off is
    // the correct pre-launch posture, and turning them on is an explicit act.
    const settings = await prisma.systemSetting.findMany({
      where: {
        OR: [
          { scope: 'ads', target: 'global' },
          { scope: 'wait', target: 'earnings' },
          { scope: 'deposits', target: 'global' },
          { scope: 'payouts', target: 'requests' },
          { scope: 'payouts', target: 'auto' },
        ],
      },
    });
    const enabled = settings
      .filter((s) => s.value && typeof s.value === 'object' && s.value.enabled === true)
      .map((s) => `${s.scope}.${s.target}`);
    ok(
      'money-switches',
      enabled.length === 0
        ? 'all fail-closed (no real money can move) — expected pre-launch'
        : `ENABLED: ${enabled.join(', ')} — confirm each rail is credential-verified`,
    );
  } catch (error) {
    fail('database', error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function checkRedis(env) {
  if (!env.REDIS_URL) {
    fail('redis', 'REDIS_URL is required in production for rate limiting and brute-force tracking');
    return;
  }
  try {
    const url = new URL(env.REDIS_URL);
    const net = await import('node:net');
    await new Promise((resolvePromise, rejectPromise) => {
      const socket = net.createConnection(
        { host: url.hostname, port: Number(url.port || 6379) },
        () => {
          socket.end();
          resolvePromise();
        },
      );
      socket.setTimeout(4000, () => {
        socket.destroy();
        rejectPromise(new Error('connection timed out'));
      });
      socket.on('error', rejectPromise);
    });
    ok('redis', `reachable at ${url.hostname}:${url.port || 6379}`);
  } catch (error) {
    fail('redis', error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  const env = process.env;
  evaluateEnvironment(env);
  if (withDb) {
    await checkDatabase(env);
    await checkRedis(env);
  } else {
    warn(
      'infrastructure',
      'skipped — re-run with --with-db to probe Postgres, Redis, and admin readiness',
    );
  }

  const width = Math.max(...results.map((r) => r.name.length));
  for (const { level, name, detail } of results) {
    const badge = level === 'PASS' ? '  ok ' : level === 'WARN' ? ' warn' : 'FAIL ';
    console.log(`[${badge}] ${name.padEnd(width)}  ${detail}`);
  }

  const failures = results.filter((r) => r.level === 'FAIL');
  const warnings = results.filter((r) => r.level === 'WARN');
  console.log(
    `\n${results.length - failures.length - warnings.length} passed, ` +
      `${warnings.length} warning(s), ${failures.length} failure(s)`,
  );
  if (failures.length > 0) {
    console.log('\nThis environment is NOT safe to deploy. Resolve every FAIL above.');
    process.exitCode = 1;
  } else {
    console.log(
      '\nPreflight passed. See docs/ops/deployment-checklist.md for the remaining steps.',
    );
  }
}

// Only run the CLI when invoked directly, so importing this module for tests
// does not execute a deploy check against the test runner's environment.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`deploy-preflight: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
