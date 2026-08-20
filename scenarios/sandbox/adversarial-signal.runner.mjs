#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireVscodeDependency = createRequire(new URL('../../apps/vscode-extension/package.json', import.meta.url));
const { build } = requireVscodeDependency('esbuild');
const mode = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ateva-adversarial-signal-'));
const output = path.join(directory, 'adapters.mjs');
await build({ entryPoints: ['apps/vscode-extension/src/detector-adapters.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' });
const { resolveAdapter } = await import(pathToFileURL(output));
const adapter = resolveAdapter(mode === 'fake-long' ? 'unrecognized-long-task' : 'mouse-jiggling');
if (adapter.signals[0]?.type !== 'inactivity' || adapter.shadowOnly !== true)
  throw new Error('untrusted activity was promoted to AI-generation evidence');
const type = mode === 'fake-long' ? 'adversarial.fake_long_task' : 'adversarial.mouse_jiggling';
process.stdout.write(`${JSON.stringify([{ eventId: `scenario-${mode}`, eventType: type, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata: { shadow: true } }])}\n`);
fs.rmSync(directory, { recursive: true, force: true });
