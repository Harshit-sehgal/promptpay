#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireVscodeDependency = createRequire(new URL('../../apps/vscode-extension/package.json', import.meta.url));
const { build } = requireVscodeDependency('esbuild');

const mode = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-concurrency-scenario-'));
const output = path.join(directory, 'correlation.mjs');

function event(eventType, metadata = {}) {
  return { eventId: `scenario-${mode}-${eventType}`, eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata };
}

function lifecycle(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    environmentKind: 'sandbox',
    environmentId: 'scenario-concurrency',
    installationId: 'scenario-installation-concurrency',
    deviceId: overrides.deviceId ?? '00000000-0000-4000-8000-000000000111',
    provider: 'claude_code',
    integrationMode: 'native_hook',
    providerSessionHash: 'a'.repeat(64),
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.8,
    occurredAt: '2026-08-06T00:00:00.000Z',
    correlationId: 'scenario-correlation',
    adapterVersion: 'scenario',
    clientVersion: 'scenario',
    metadata: {},
    ...overrides,
  };
}

async function run() {
  await build({ entryPoints: ['apps/vscode-extension/src/agent-session-correlation.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' });
  const { AgentSessionCorrelation } = await import(pathToFileURL(output));
  const correlation = new AgentSessionCorrelation();
  if (mode === 'two-sessions') {
    correlation.accept(lifecycle({ providerSessionHash: 'a'.repeat(64), correlationId: 'provider-a' }));
    correlation.accept(lifecycle({ providerSessionHash: 'b'.repeat(64), correlationId: 'provider-b' }));
    if (correlation.values().length !== 2) throw new Error('two provider sessions were merged');
    process.stdout.write(`${JSON.stringify([event('concurrency.two_sessions', { sessions: 2 })])}\n`);
  } else if (mode === 'wrapper-duplicate') {
    const native = lifecycle({ providerSessionHash: 'a'.repeat(64), correlationId: 'native' });
    correlation.accept(native);
    const wrapper = lifecycle({ providerSessionHash: undefined, correlationId: 'wrapper', provider: 'generic_wrapper', integrationMode: 'wrapper', metadata: { executableFamily: 'claude_code' } });
    const merged = correlation.accept(wrapper);
    if (merged.session.eventCount !== 2 || merged.session.integrationMode !== 'native_hook') throw new Error('wrapper duplicate was not merged under native precedence');
    process.stdout.write(`${JSON.stringify([event('concurrency.wrapper_deduplicated', { nativePrecedence: true })])}\n`);
  } else if (mode === 'parallel-subagents') {
    for (const hash of ['a', 'b', 'c']) correlation.accept(lifecycle({ providerSessionHash: hash.repeat(64), provider: 'claude_code', correlationId: `subagent-${hash}` }));
    if (correlation.values().length !== 3) throw new Error('parallel subagents were not kept separate');
    process.stdout.write(`${JSON.stringify([event('concurrency.parallel_subagents', { sessions: 3 })])}\n`);
  } else if (mode === 'one-completes') {
    correlation.accept(lifecycle({ providerSessionHash: 'a'.repeat(64), correlationId: 'task-a', eventType: 'task.completed' }));
    correlation.accept(lifecycle({ providerSessionHash: 'b'.repeat(64), correlationId: 'task-b', eventType: 'task.created' }));
    const statuses = correlation.values().map((session) => session.status).sort();
    if (statuses.join(',') !== 'active,completed') throw new Error('completion of one task changed the other active task');
    process.stdout.write(`${JSON.stringify([event('concurrency.partial_completion', { activeSessions: 1, completedSessions: 1 })])}\n`);
  } else if (mode === 'two-devices') {
    correlation.accept(lifecycle({ providerSessionHash: 'a'.repeat(64), deviceId: '00000000-0000-4000-8000-000000000111', correlationId: 'device-a' }));
    correlation.accept(lifecycle({ providerSessionHash: 'b'.repeat(64), deviceId: '00000000-0000-4000-8000-000000000112', correlationId: 'device-b' }));
    if (correlation.values().length !== 2 || new Set(correlation.values().map((s) => s.deviceId)).size !== 2) throw new Error('same-user devices were merged');
    process.stdout.write(`${JSON.stringify([event('concurrency.two_devices', { isolated: true })])}\n`);
  } else if (mode === 'out-of-order') {
    const ended = lifecycle({ providerSessionHash: 'c'.repeat(64), correlationId: 'ordered-session', eventType: 'session.ended', sequence: 10, occurredAt: '2026-08-06T00:00:10.000Z' });
    correlation.accept(ended);
    const stale = correlation.accept(lifecycle({ providerSessionHash: ended.providerSessionHash, correlationId: 'ordered-session', eventType: 'turn.processing_started', sequence: 1, occurredAt: '2026-08-06T00:00:01.000Z' }));
    if (stale.session.status !== 'ended' || stale.session.lastSequence !== 10) throw new Error('out-of-order event rewound terminal state');
    process.stdout.write(`${JSON.stringify([event('reliability.out_of_order_rejected', { retainedSequence: 10 })])}\n`);
  } else if (mode === 'ten-sessions') {
    for (let index = 0; index < 10; index += 1) {
      correlation.accept(lifecycle({ providerSessionHash: String(index).repeat(64), correlationId: `agent-${index}` }));
    }
    if (correlation.values().length !== 10) throw new Error('ten concurrent agents were not independently correlated');
    process.stdout.write(`${JSON.stringify([event('adversarial.ten_sessions', { sessions: 10 })])}\n`);
  } else if (mode === 'repeated-completion') {
    const first = lifecycle({ providerSessionHash: 'd'.repeat(64), correlationId: 'completion', eventType: 'task.completed' });
    const accepted = correlation.accept(first);
    const replay = correlation.accept(first);
    if (!accepted.accepted || !replay.duplicate || correlation.values()[0]?.eventCount !== 1)
      throw new Error('repeated completion was not rejected as a replay');
    process.stdout.write(`${JSON.stringify([event('adversarial.repeated_completion', { duplicate: true })])}\n`);
  } else throw new Error(`unknown concurrency mode: ${mode}`);
}

try { await run(); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
