import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearAgentTelemetry,
  enqueueAgentEvent,
  getSpoolPaths,
  readSpoolStatus,
} from '../../apps/cli/dist/lib/agent-spool.js';
import { getCodexCapabilityStatus } from '../../apps/cli/dist/lib/codex-adapter.js';
import { createGenericWrapperEvent } from '../../apps/cli/dist/lib/generic-wrapper-adapter.js';
import { HookConfigManager } from '../../apps/cli/dist/lib/hook-config.js';
import { normalizeHookEvent, readHookInputJson, resolveEventType } from '../../apps/cli/dist/lib/hook-ingestion.js';
import { spawnSupervisedCommand } from '../../apps/cli/dist/commands/run.js';

const caseName = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-scenario-cli-'));
const installationId = 'cli-boundary-installation-v1';
const deviceId = '00000000-0000-4000-8000-000000000081';

function event(eventType, metadata = {}) {
  return {
    eventId: `scenario-${caseName}-${eventType}`,
    eventType,
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
    metadata,
  };
}

function validSpoolEvent(id = randomUUID()) {
  return {
    schemaVersion: 1,
    eventId: id,
    idempotencyKey: `scenario-${id}`,
    environmentKind: 'sandbox',
    environmentId: 'scenario-cli-boundary',
    installationId,
    deviceId,
    provider: 'generic_wrapper',
    integrationMode: 'wrapper',
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.5,
    occurredAt: '2026-08-06T00:00:00.000Z',
    correlationId: `scenario-${id}`,
    adapterVersion: 'scenario',
    clientVersion: 'scenario',
    metadata: {},
  };
}

try {
  const paths = getSpoolPaths(directory);
  if (caseName === 'hooks-disabled') {
    const configPath = path.join(directory, '.claude', 'settings.json');
    const manager = new HookConfigManager({
      homeDir: directory,
      configPaths: { 'claude-code': configPath },
      stateDir: path.join(directory, 'state'),
      executable: '/usr/bin/true',
    });
    manager.install('claude-code');
    const disabled = manager.setDisabled('claude-code', true);
    if (disabled.status !== 'disabled' || !manager.isDisabled('claude-code'))
      throw new Error('provider disable state was not persisted');
    process.stdout.write(`${JSON.stringify([event('integration.disabled', { provider: 'claude_code' })])}\n`);
  } else if (caseName === 'codex-unsupported') {
    const configPath = path.join(directory, '.codex', 'hooks.json');
    const capability = getCodexCapabilityStatus(configPath);
    const manager = new HookConfigManager({
      homeDir: directory,
      configPaths: { codex: configPath },
      stateDir: path.join(directory, 'state'),
      executable: '/usr/bin/true',
    });
    const installed = manager.install('codex');
    if (!capability.supported || capability.trustStatus !== 'unverified' || installed.status !== 'degraded' || manager.isTrusted('codex'))
      throw new Error('Codex native integration did not remain trust-gated');
    process.stdout.write(`${JSON.stringify([event('integration.unverified', { provider: capability.provider, trustRequired: true })])}\n`);
  } else if (caseName === 'wrapper-fallback') {
    const wrapper = createGenericWrapperEvent({
      installationId,
      deviceId,
      correlationId: 'scenario-wrapper-fallback',
      executable: '/opt/tools/claude-code',
      eventType: 'session.ended',
      occurredAt: new Date('2026-08-06T00:00:00.000Z'),
      durationMs: 6000,
      exitCode: 0,
    });
    if (wrapper.integrationMode !== 'wrapper' || wrapper.metadata.executableFamily !== 'claude_code')
      throw new Error('wrapper fallback did not produce a bounded wrapper event');
    process.stdout.write(`${JSON.stringify([event('wrapper.completed', wrapper.metadata)])}\n`);
  } else if (caseName === 'malformed-hook-json') {
    if (readHookInputJson('{ malformed') !== null || readHookInputJson('[]') !== null)
      throw new Error('malformed hook input was accepted');
    const normalized = normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'SessionStart',
      input: { prompt: 'should not be retained' },
      installationId,
      deviceId,
    });
    if (!normalized) throw new Error('valid hook normalization unexpectedly failed');
    process.stdout.write(`${JSON.stringify([event('hook.rejected', { reason: 'malformed_json' })])}\n`);
  } else if (caseName === 'duplicate-upload') {
    const payload = validSpoolEvent('00000000-0000-4000-8000-000000000068');
    enqueueAgentEvent({ installationId, deviceId, event: payload }, paths);
    enqueueAgentEvent({ installationId, deviceId, event: payload }, paths);
    if (readSpoolStatus(paths).queuedEvents !== 1) throw new Error('duplicate event was queued twice');
    process.stdout.write(`${JSON.stringify([event('upload.deduplicated', { queuedEvents: 1 })])}\n`);
  } else if (caseName === 'old-schema-quarantine') {
    enqueueAgentEvent({ installationId, deviceId, event: validSpoolEvent() }, paths);
    const lines = fs.readFileSync(paths.queueFile, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[0]);
    record.event.schemaVersion = 0;
    fs.writeFileSync(paths.queueFile, `${JSON.stringify(record)}\n`);
    const status = readSpoolStatus(paths);
    if (status.queuedEvents !== 0 || status.quarantinedEvents !== 1)
      throw new Error('old-schema queue record was not quarantined');
    process.stdout.write(`${JSON.stringify([event('queue.quarantined', { quarantinedEvents: 1 })])}\n`);
  } else if (caseName === 'missing-executable') {
    await Promise.all([
      spawnSupervisedCommand(['/definitely/missing/waitlayer-ai-executable']).then(
        () => { throw new Error('missing executable unexpectedly spawned'); },
        (error) => {
          if (!String(error?.message ?? error).match(/ENOENT|spawn/))
            throw new Error('missing executable returned an unexpected error');
        },
      ),
    ]);
    process.stdout.write(`${JSON.stringify([event('process.spawn_rejected', { telemetry: 'not_started' })])}\n`);
  } else if (caseName === 'hooks-and-account-deletion') {
    const configPath = path.join(directory, '.claude', 'settings.json');
    const manager = new HookConfigManager({
      homeDir: directory,
      configPaths: { 'claude-code': configPath },
      stateDir: path.join(directory, 'state'),
      executable: '/usr/bin/true',
    });
    manager.install('claude-code');
    enqueueAgentEvent({ installationId, deviceId, event: validSpoolEvent() }, paths);
    clearAgentTelemetry(paths);
    const removed = manager.uninstall('claude-code');
    const postDelete = manager.status('claude-code');
    if (postDelete.installed || readSpoolStatus(paths).bytes !== 0 || !removed.changed)
      throw new Error('account deletion left hooks or local telemetry behind');
    process.stdout.write(`${JSON.stringify([event('account.deleted', { hooksRemoved: true })])}\n`);
  } else if (caseName === 'renamed-fake-process') {
    const wrapper = createGenericWrapperEvent({
      installationId,
      deviceId,
      correlationId: 'scenario-renamed-process',
      executable: '/tmp/renamed-ai-process',
      eventType: 'session.ended',
      occurredAt: new Date('2026-08-06T00:00:00.000Z'),
      durationMs: 120000,
      exitCode: 0,
    });
    if (wrapper.integrationMode !== 'wrapper' || wrapper.metadata.executableFamily !== 'other' || wrapper.sourceType !== 'inferred')
      throw new Error('renamed process was trusted as a native provider');
    process.stdout.write(`${JSON.stringify([event('process.renamed_untrusted', { integrationMode: wrapper.integrationMode })])}\n`);
  } else if (caseName === 'tampered-hook-event') {
    if (resolveEventType('DeleteEverything') !== null || normalizeHookEvent({
      provider: 'claude_code',
      providerEvent: 'DeleteEverything',
      input: { eventType: 'session.ended', prompt: 'tampered' },
      installationId,
      deviceId,
    }) !== null) {
      throw new Error('tampered hook event was accepted');
    }
    process.stdout.write(`${JSON.stringify([event('hook.tampered_rejected', { accepted: false })])}\n`);
  } else {
    throw new Error(`unknown CLI boundary case: ${caseName}`);
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
