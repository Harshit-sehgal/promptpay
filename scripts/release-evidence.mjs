#!/usr/bin/env node
/**
 * Generate a small, machine-readable release evidence manifest. The script is
 * intentionally dependency-free and does not claim gates passed: callers pass
 * recorded results explicitly or leave them as pending.
 *
 * Usage:
 *   node scripts/release-evidence.mjs --output artifacts/release-evidence.json
 *   node scripts/release-evidence.mjs --output report.json --environment sandbox --protocol 1 \
 *     --gate typecheck=passed --gate lint=passed
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function valueAfter(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function allAfter(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function git(commandArgs) {
  try {
    return execFileSync('git', commandArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

function packageVersions() {
  const files = ['package.json', 'packages/agent-protocol/package.json'];
  return Object.fromEntries(
    files.map((file) => {
      try {
        return [file, JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')).version ?? 'unknown'];
      } catch {
        return [file, 'unavailable'];
      }
    }),
  );
}

const strict = args.includes('--strict') || process.env.RELEASE_EVIDENCE_STRICT === '1';
const explicitEnvironment =
  args.includes('--environment') || Boolean(process.env.ATEVA_ENVIRONMENT_KIND);
const environmentKind = valueAfter('--environment', process.env.ATEVA_ENVIRONMENT_KIND);
const environmentId = valueAfter('--environment-id', process.env.ATEVA_ENVIRONMENT_ID);
const protocolVersion = Number(valueAfter('--protocol', '1'));
const output = resolve(ROOT, valueAfter('--output', 'artifacts/release-evidence.json'));
const gateResults = Object.fromEntries(
  allAfter('--gate').map((entry) => {
    const separator = entry.indexOf('=');
    return separator > 0
      ? [entry.slice(0, separator), entry.slice(separator + 1)]
      : [entry, 'pending'];
  }),
);

if (strict) {
  if (!explicitEnvironment || !environmentKind || !environmentId)
    throw new Error('Strict release evidence requires environment kind and id');
  if (!['development', 'test', 'sandbox', 'staging', 'production'].includes(environmentKind))
    throw new Error('Unknown environment kind');
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1)
    throw new Error('Invalid protocol version');
  if (!process.env.RELEASE_MIGRATION_STATUS)
    throw new Error('Strict release evidence requires RELEASE_MIGRATION_STATUS');
  if (
    !/^sha256:[a-f0-9]{64}$/.test(process.env.RELEASE_API_IMAGE_DIGEST ?? '') ||
    !/^sha256:[a-f0-9]{64}$/.test(process.env.RELEASE_WEB_IMAGE_DIGEST ?? '')
  ) {
    throw new Error('Strict release evidence requires immutable API and web Docker digests');
  }
  const requiredGates = ['typecheck', 'lint', 'test', 'build'];
  if (requiredGates.some((gate) => gateResults[gate] !== 'passed')) {
    throw new Error(`Strict release evidence requires passed gates: ${requiredGates.join(', ')}`);
  }
  if (Object.values(gateResults).some((status) => status !== 'passed')) {
    throw new Error('Strict release evidence cannot contain a non-passed gate');
  }
  if (git(['status', '--porcelain']) !== '')
    throw new Error('Strict release evidence requires a clean worktree');
}

const manifest = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: 'Ateva',
  git: {
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    dirty: git(['status', '--porcelain']) !== '',
  },
  environmentKind: environmentKind ?? 'development',
  environmentId: environmentId ?? 'local',
  protocolVersion,
  packageVersions: packageVersions(),
  migrations: {
    latestDirectory: (() => {
      try {
        return (
          readdirSync(resolve(ROOT, 'packages/db/prisma/migrations')).sort().at(-1) ?? 'unavailable'
        );
      } catch {
        return 'unavailable';
      }
    })(),
    status: process.env.RELEASE_MIGRATION_STATUS ?? 'not-recorded',
  },
  dockerDigests: {
    api: process.env.RELEASE_API_IMAGE_DIGEST ?? null,
    web: process.env.RELEASE_WEB_IMAGE_DIGEST ?? null,
  },
  gates: gateResults,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote release evidence manifest to ${output}`);
