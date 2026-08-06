#!/usr/bin/env node
/** Execute a constrained disposable scenario fixture and report its sanitized trace. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildScenarioReport } from './scenario-report.mjs';
import { findPrivacyCanaries, validateManifest } from './scenario-audit.mjs';

export async function runScenario(manifestPath) {
  const startedAt = new Date().toISOString();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`invalid scenario: ${errors.join(', ')}`);
  if (
    !manifest.runner ||
    manifest.runner.command !== 'node' ||
    !Array.isArray(manifest.runner.args)
  ) {
    throw new Error('scenario runner must use a Node fixture command');
  }
  const args = manifest.runner.args.map(String);
  if (args.some((arg) => ['-e', '--eval', '-p', '--print', '-r', '--require'].includes(arg))) {
    throw new Error('scenario runner forbids Node eval/require flags');
  }
  const cwd = process.cwd();
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    const resolved = path.resolve(cwd, arg);
    if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`))
      throw new Error('scenario runner path escapes repository root');
  }
  const timeoutMs = Math.min(Math.max(Number(manifest.runner.timeoutMs ?? 5000), 100), 30_000);
  const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
  const chunks = { stdout: [], stderr: [] };
  const bytes = { stdout: 0, stderr: 0 };
  let settled = false;
  /**
   * Kill the whole POSIX process group. A fixture that spawns grandchildren
   * (or a grandchild that inherits stdout) must not outlive the run: killing
   * only the direct child would leave the group running and the pipes open.
   */
  const teardown = (child) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already exited */
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }, 500).unref?.();
  };
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const fail = (message) => {
      if (settled) return;
      settled = true;
      teardown(child);
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('scenario fixture timed out'), timeoutMs);
    const onData = (stream) => (chunk) => {
      if (settled) return;
      chunks[stream].push(chunk);
      bytes[stream] += chunk.length;
      if (bytes[stream] > MAX_OUTPUT_BYTES) {
        fail(`scenario fixture exceeded the ${stream} output cap (2 MiB)`);
      }
    };
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  if (exitCode !== 0)
    throw new Error(
      `scenario fixture exited with ${exitCode}: ${Buffer.concat(chunks.stderr).toString().slice(0, 500)}`,
    );
  let trace;
  try {
    trace = JSON.parse(Buffer.concat(chunks.stdout).toString());
  } catch {
    throw new Error('scenario fixture did not emit a JSON trace');
  }
  const canaries = findPrivacyCanaries(JSON.stringify(trace));
  if (canaries.length)
    throw new Error(`privacy canary triggered: ${canaries.join(', ')}`);
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) throw new Error(`invalid scenario: ${manifestErrors.join(', ')}`);
  return { manifest, trace, startedAt, endedAt: new Date().toISOString() };
}

if (process.argv[1]?.endsWith('/scenario-runner.mjs')) {
  const manifestPath = process.argv[2] === '--' ? process.argv[3] : process.argv[2];
  if (!manifestPath) {
    console.error('usage: node scripts/scenario-runner.mjs <manifest.json>');
    process.exitCode = 2;
  } else {
    runScenario(manifestPath)
      .then(({ manifest, trace, startedAt, endedAt }) => {
        const report = buildScenarioReport({
          manifest,
          trace,
          buildSha: process.env.GIT_SHA ?? 'unknown',
          environmentId: process.env.WAITLAYER_ENVIRONMENT_ID ?? 'unknown',
          startedAt,
          endedAt,
        });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.status !== 'passed') process.exitCode = 1;
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
