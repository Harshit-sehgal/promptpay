#!/usr/bin/env node
/** Execute a constrained disposable scenario fixture and report its sanitized trace. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildScenarioReport } from './scenario-report.mjs';
import { validateManifest } from './scenario-audit.mjs';

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
  const stdout = [];
  const stderr = [];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('scenario fixture timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  if (exitCode !== 0)
    throw new Error(
      `scenario fixture exited with ${exitCode}: ${Buffer.concat(stderr).toString().slice(0, 500)}`,
    );
  let trace;
  try {
    trace = JSON.parse(Buffer.concat(stdout).toString());
  } catch {
    throw new Error('scenario fixture did not emit a JSON trace');
  }
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
