#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireVscodeDependency = createRequire(new URL('../../apps/vscode-extension/package.json', import.meta.url));
const { build } = requireVscodeDependency('esbuild');

const mode = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-vscode-detector-'));

function event(eventType, metadata = {}) {
  return { eventId: `scenario-${mode}-${eventType}`, eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata };
}

async function bundle(name, source) {
  const output = path.join(directory, `${name}.mjs`);
  await build({ entryPoints: [path.resolve(source)], outfile: output, bundle: true, format: 'esm', platform: 'node' });
  return import(pathToFileURL(output));
}

async function run() {
  const adapters = await bundle('detector-adapters', 'apps/vscode-extension/src/detector-adapters.ts');
  const policy = await bundle('detector-policy', 'apps/vscode-extension/src/detector-policy.ts');
  const quietHours = await bundle('quiet-hours', 'apps/vscode-extension/src/quiet-hours.ts');
  if (mode === 'terminal') {
    const signals = adapters.mapToolToSignals('terminal');
    if (signals[0]?.type !== 'lifecycle_event') throw new Error('terminal inside VS Code was not classified as a lifecycle event');
    process.stdout.write(`${JSON.stringify([event('vscode.terminal_lifecycle', { signal: signals[0].type })])}\n`);
  } else if (mode === 'shell-missing') {
    const signals = adapters.mapToolToSignals('unrecognized-shell-integration');
    if (signals[0]?.type !== 'inactivity' || !adapters.resolveAdapter('unrecognized-shell-integration').shadowOnly)
      throw new Error('missing shell integration was treated as AI proof');
    process.stdout.write(`${JSON.stringify([event('vscode.shell_integration_missing', { shadow: true })])}\n`);
  } else if (mode === 'inactivity') {
    const adapter = adapters.resolveAdapter('inactivity');
    if (adapter.signals[0]?.type !== 'inactivity' || adapter.shadowOnly !== true)
      throw new Error('inactivity was not shadow-only');
    process.stdout.write(`${JSON.stringify([event('vscode.inactivity_shadow', { monetizable: false })])}\n`);
  } else if (mode === 'false-positive') {
    const until = policy.computeSuppressUntil(30, 1_000);
    if (!policy.isSuppressed(until, 1_001) || policy.isSuppressed(until, until))
      throw new Error('false-positive suppression window was not enforced');
    process.stdout.write(`${JSON.stringify([event('vscode.false_positive_suppressed', { durationMinutes: 30 })])}\n`);
  } else if (mode === 'quiet-hours') {
    if (!quietHours.isTimeInRange('23:00', '22:00', '08:00') || quietHours.isTimeInRange('12:00', '22:00', '08:00'))
      throw new Error('quiet-hours midnight range was evaluated incorrectly');
    process.stdout.write(`${JSON.stringify([event('vscode.quiet_mode', { suppressed: true })])}\n`);
  } else throw new Error(`unknown VS Code detector mode: ${mode}`);
}

try { await run(); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
