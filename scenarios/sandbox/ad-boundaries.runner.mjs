#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const requireVscodeDependency = createRequire(new URL('../../apps/vscode-extension/package.json', import.meta.url));
const { build } = requireVscodeDependency('esbuild');
const mode = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-ad-boundary-'));

function event(eventType, metadata = {}) {
  return { eventId: `scenario-${mode}-${eventType}`, eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata };
}

async function runDismiss() {
  const output = path.join(directory, 'ad-panel.mjs');
  let disposeHandler;
  let visibility = [];
  const virtualVscode = `let disposeHandler; export const ViewColumn={Beside:2}; export const env={openExternal:async()=>true}; export const Uri={parse:(value)=>{const scheme=value.split(':')[0]; return {scheme,value};}}; export const window={createWebviewPanel:()=>{const panel={webview:{cspSource:'vscode-resource:',html:'',onDidReceiveMessage:()=>({dispose(){}})},onDidDispose:(fn)=>{disposeHandler=fn; return {dispose(){}}},dispose:()=>{disposeHandler?.();}}; return panel;}};`;
  await build({
    entryPoints: ['apps/vscode-extension/src/ad-panel.ts'],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [{ name: 'vscode-stub', setup(plugin) { plugin.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode-stub', namespace: 'scenario' })); plugin.onLoad({ filter: /.*/, namespace: 'scenario' }, () => ({ contents: virtualVscode, loader: 'js' })); } }],
  });
  const { AdPanel } = await import(pathToFileURL(output));
  const panel = new AdPanel({}, { recordClick: async () => undefined, recordImpressionEnd: async () => undefined }, (visible) => visibility.push(visible));
  let completed = false;
  panel.show({ headline: 'Sandbox', message: 'Test', ctaText: 'Open', ctaUrl: 'https://sandbox.waitlayer.test', impressionToken: 'sandbox-token' }, () => { completed = true; });
  panel.hide({ complete: false });
  if (completed || visibility.join(',') !== 'true,false') throw new Error(`dismissal incorrectly completed the ad: completed=${completed} visibility=${visibility.join(',')}`);
  process.stdout.write(`${JSON.stringify([event('ad.dismissed', { completed: false })])}\n`);
}

async function runReport() {
  const { ExtensionDeviceReportTrait } = await import('../../apps/api/dist/apps/api/src/extension/extension-device-report.trait.js');
  const operations = [];
  const report = { id: 'scenario-report', impressionId: 'scenario-impression', userId: 'scenario-ad-user' };
  const trait = new ExtensionDeviceReportTrait();
  Object.assign(trait, {
    prisma: {
      adImpression: { findUnique: async () => ({ id: 'scenario-impression', userId: 'scenario-ad-user', deviceId: 'scenario-device', creativeId: 'scenario-creative', isBillable: false }) },
      adReport: { findUnique: async () => null, create: async ({ data }) => { operations.push({ type: 'report', data }); return report; } },
      $transaction: async (items) => Promise.all(items),
    },
    ledger: { reverseEarnings: async () => ({ paidSkipped: 0 }) },
    audit: { log: async () => undefined },
    logger: { warn: () => undefined },
    enforcePrivacyOn: () => undefined,
    verifyDeviceSignature: async () => true,
  });
  trait.prisma.adImpression.update = async ({ data }) => { operations.push({ type: 'invalidate', data }); return { id: 'scenario-impression', ...data }; };
  const result = await trait.reportAd('scenario-ad-user', { impressionToken: 'scenario-token', reason: 'misleading', details: 'sandbox test', signature: 'scenario-signature' });
  if (result.id !== report.id || !operations.some((entry) => entry.type === 'invalidate' && entry.data.isBillable === false)) throw new Error('ad report did not invalidate the impression');
  process.stdout.write(`${JSON.stringify([event('ad.reported', { invalidated: true })])}\n`);
}

try {
  if (mode === 'dismiss') await runDismiss();
  else if (mode === 'report') await runReport();
  else throw new Error(`unknown ad boundary mode: ${mode}`);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
