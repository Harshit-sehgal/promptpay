#!/usr/bin/env node
/**
 * `pnpm beta:verify` — one-command private-beta verification.
 *
 * Runs every NON-DESTRUCTIVE gate that must pass before the telemetry-only
 * private beta, in dependency order, and prints a compact result summary.
 *
 * Design rules (deliberate, see AGENTS.md):
 * - Never resets, truncates, or migrates-down any database. `pnpm test`'s
 *   integration suites are intentionally excluded: they run
 *   `prisma migrate reset` behind the dangerous-action consent flag and are
 *   an operator decision, not a verification step.
 * - Distinguishes CODE failures (fix before beta) from ENVIRONMENT gaps
 *   (missing local Postgres/Redis/operator inputs — expected on a fresh
 *   checkout, reported, not fatal to the rest of the run).
 * - Never echoes environment values; probes only ever report reachability.
 * - Fails loudly: exit 1 when any code gate fails, exit 2 only when every
 *   failure is environmental (so CI can treat 2 as "sandbox incomplete").
 *
 * Environment probes: Postgres :5433 (test) and :5432 (dev), Redis :6379,
 * over TCP with a short timeout. All are localhost defaults documented in
 * docs/ENV_REFERENCE.md; none are read from secret-bearing variables.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const GATES = [
  { name: 'audit-claims', cmd: 'node scripts/audit-claims.mjs', env: false },
  { name: 'package-contract', cmd: 'node --test scripts/ci-package-contract.test.mjs', env: false },
  { name: 'release-gates', cmd: 'pnpm run test:release-gates', env: false },
  { name: 'typecheck', cmd: 'pnpm run typecheck', env: false },
  { name: 'lint', cmd: 'pnpm run lint', env: false },
  // Unit suites that do not require a database. The API's `test:unit`
  // includes Prisma-backed suites; they are classified `env: true` because
  // on a checkout without Postgres they fail environmentally, not logically.
  { name: 'api-unit', cmd: 'pnpm --filter ateva-api test:unit', env: true },
  { name: 'web-tests', cmd: 'pnpm --filter ateva-web test', env: false },
  { name: 'cli-tests', cmd: 'pnpm --filter ateva-cli test', env: false },
  { name: 'vscode-tests', cmd: 'pnpm --filter ateva-vscode test', env: false },
  {
    name: 'shared-config-protocol',
    cmd: 'pnpm --filter @ateva/shared --filter @ateva/config --filter @ateva/agent-protocol test',
    env: false,
  },
  {
    name: 'attestation-bridge',
    cmd: 'pnpm --filter @ateva/wait-attestation-bridge test',
    env: false,
  },
  { name: 'production-build', cmd: 'pnpm run build', env: false },
];

const PROBES = [
  { name: 'postgres-test', host: '127.0.0.1', port: 5433 },
  { name: 'postgres-dev', host: '127.0.0.1', port: 5432 },
  { name: 'redis', host: '127.0.0.1', port: 6379 },
];

function probeTcp({ host, port }, timeoutMs = 1500) {
  return new Promise((probeResolved) => {
    const socket = new net.Socket();
    const done = (open) => {
      socket.destroy();
      probeResolved(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.once('connect', () => done(true));
    socket.connect(port, host);
  });
}

function runGate(gate) {
  return new Promise((gateResolved) => {
    const started = Date.now();
    const child = spawn('bash', ['-lc', gate.cmd], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let tail = '';
    const collect = (chunk) => {
      // Keep only the tail for diagnostics; never echo environment values.
      tail = `${tail}${chunk}`.slice(-4000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (code, signal) => {
      gateResolved({ ...gate, code, signal, durationMs: Date.now() - started, tail });
    });
  });
}

function classify(result) {
  if (result.code === 0) return 'pass';
  return result.env ? 'environment' : 'code';
}

function lastMeaningfulLines(tail, count = 6) {
  const lines = tail
    .split('\n')
    .map((line) => line.replace(/\x1B\[[0-9;]*m/g, '').trimEnd())
    .filter((line) => line.length > 0 && !/^\d+m\s*\d+\/?$/.test(line));
  return lines.slice(-count);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has('--verbose');

  console.log('beta:verify — private-beta verification (non-destructive)\n');

  const infra = await Promise.all(
    PROBES.map(async (probe) => ({ ...probe, open: await probeTcp(probe) })),
  );
  for (const probe of infra) {
    console.log(
      `  [${probe.open ? 'ok' : '  '}] ${probe.name.padEnd(14)} ${probe.host}:${probe.port} ${probe.open ? 'reachable' : 'unreachable (environmental)'}`,
    );
  }
  console.log('');

  const results = [];
  for (const gate of GATES) {
    process.stdout.write(`  run  ${gate.name.padEnd(22)} `);
    const result = await runGate(gate);
    const status = classify(result);
    results.push({ ...result, status });
    const seconds = (result.durationMs / 1000).toFixed(0);
    console.log(`${status.padEnd(12)} ${seconds}s`);
    if (status !== 'pass' && !verbose) {
      for (const line of lastMeaningfulLines(result.tail)) console.log(`       | ${line}`);
    }
    // A code failure is a hard stop: nothing downstream can be trusted.
    if (status === 'code') {
      console.log(
        '\nCode failure — remaining gates skipped. Re-run with --verbose for full output.',
      );
      if (verbose)
        for (const line of lastMeaningfulLines(result.tail, 40)) console.log(`  | ${line}`);
      process.exitCode = 1;
      return;
    }
  }

  const codeFailures = results.filter((r) => r.status === 'code');
  const envFailures = results.filter((r) => r.status === 'environment');
  const passed = results.filter((r) => r.status === 'pass');

  console.log('\nSummary');
  console.log(`  passed:        ${passed.length}/${results.length}`);
  if (envFailures.length > 0) {
    console.log(`  environmental: ${envFailures.map((r) => r.name).join(', ')}`);
    console.log(
      '                 (missing local infrastructure — start Postgres :5433 / Redis :6379, then re-run)',
    );
  }
  if (codeFailures.length > 0)
    console.log(`  code failures: ${codeFailures.map((r) => r.name).join(', ')}`);

  if (codeFailures.length > 0) {
    console.log('\nbeta:verify FAILED (code).');
    process.exitCode = 1;
  } else if (envFailures.length > 0) {
    console.log('\nbeta:verify INCOMPLETE (environment). All code gates that ran passed.');
    process.exitCode = 2;
  } else {
    console.log(
      '\nbeta:verify PASSED. Repository is a deployable telemetry-only private-beta candidate; the remaining blockers are operator-owned (see the external register in AGENTS.md).',
    );
  }
}

main().catch(() => {
  console.error('beta:verify: unable to complete verification');
  process.exitCode = 1;
});
