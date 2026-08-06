#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const requireVscodeDependency = createRequire(new URL('../../apps/vscode-extension/package.json', import.meta.url));
const { build } = requireVscodeDependency('esbuild');

const mode = process.argv[2];
const source = path.resolve('apps/vscode-extension/src/attention-state-machine.ts');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-vscode-scenario-'));
const compiled = path.join(directory, 'attention-state-machine.mjs');

function event(eventType, metadata = {}) {
  return {
    eventId: `scenario-${mode}-${eventType}`,
    eventType,
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
    metadata,
  };
}

async function loadMachine() {
  await build({ entryPoints: [source], outfile: compiled, bundle: true, format: 'esm', platform: 'node' });
  return (await import(pathToFileURL(compiled))).AttentionStateMachine;
}

async function run() {
  const AttentionStateMachine = await loadMachine();
  if (mode === 'foreground') {
    const machine = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-1' });
    machine.setWindowFocused(true);
    if (machine.getState() !== 'foreground_not_visible' || !machine.reserveOwner()) throw new Error('foreground reservation failed');
    machine.setSurfaceVisible(true);
    if (machine.getState() !== 'foreground_visible' || !machine.isOwner()) throw new Error('foreground surface was not owned');
    machine.dispose();
    process.stdout.write(`${JSON.stringify([event('vscode.foreground', { owner: true })])}\n`);
    return;
  }
  if (mode === 'background-return') {
    const machine = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-1' });
    machine.setWindowFocused(true);
    machine.setSurfaceVisible(true);
    machine.setWindowFocused(false);
    if (machine.getState() !== 'background' || machine.isOwner()) throw new Error('background transition retained ownership');
    machine.setWindowFocused(true);
    if (machine.getState() !== 'foreground_visible' || !machine.isOwner()) throw new Error('return did not restore foreground ownership');
    machine.dispose();
    process.stdout.write(`${JSON.stringify([event('vscode.background_return', { restored: true })])}\n`);
    return;
  }
  if (mode === 'multiple-windows') {
    const first = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-1' });
    const second = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-2' });
    first.setWindowFocused(true); first.setSurfaceVisible(true);
    second.setWindowFocused(true); second.setSurfaceVisible(true);
    if (!first.isOwner() || second.isOwner()) throw new Error('multiple windows shared one attention owner');
    first.reset();
    if (!second.isOwner() || second.getState() !== 'foreground_visible') throw new Error('owner release did not promote the second window');
    first.dispose(); second.dispose();
    process.stdout.write(`${JSON.stringify([event('vscode.single_owner', { promotedSecondWindow: true })])}\n`);
    return;
  }
  if (mode === 'reload') {
    const first = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-1' });
    first.setWindowFocused(true); first.setSurfaceVisible(true); first.dispose();
    const reloaded = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-1' });
    reloaded.setWindowFocused(true); reloaded.setSurfaceVisible(true);
    if (reloaded.getState() !== 'foreground_visible' || !reloaded.isOwner()) throw new Error('reloaded extension did not reclaim attention');
    reloaded.dispose();
    process.stdout.write(`${JSON.stringify([event('vscode.reloaded', { stateRestored: true })])}\n`);
    return;
  }
  if (mode === 'closed') {
    const machine = new AttentionStateMachine({ installationId: 'scenario-vscode-installation', ownerId: 'window-1' });
    machine.setWindowFocused(true); machine.setSurfaceVisible(true); machine.setBridgeConnected(false);
    if (machine.getState() !== 'disconnected' || machine.isOwner()) throw new Error('closed VS Code window retained attention');
    machine.dispose();
    process.stdout.write(`${JSON.stringify([event('vscode.closed', { disconnected: true })])}\n`);
    return;
  }
  throw new Error(`unknown VS Code attention mode: ${mode}`);
}

try {
  await run();
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
