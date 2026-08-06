#!/usr/bin/env node
const mode = process.argv[2];
const { adaptCodexHook } = await import('../../apps/cli/dist/lib/codex-adapter.js');
const { normalizeHookEvent } = await import('../../apps/cli/dist/lib/hook-ingestion.js');

const definitions = {
  normal: {
    providerEvent: 'Stop',
    expected: 'turn.completed',
    payload: { session_id: 'codex-session-normal', turn_id: 'codex-turn-normal', last_assistant_message: 'private output' },
    eventType: 'codex.normal_completion',
  },
  permission: {
    providerEvent: 'PermissionRequest',
    expected: 'permission.required',
    payload: { session_id: 'codex-session-permission', turn_id: 'codex-turn-permission', tool_name: 'exec', tool_input: { command: 'cat private.txt' } },
    eventType: 'codex.permission_request',
  },
  subagent: {
    providerEvent: 'SubagentStart',
    expected: 'subagent.started',
    payload: { session_id: 'codex-session-parent', turn_id: 'codex-turn-parent', agent_id: 'codex-agent-child', agent_type: 'worker', transcript_path: '/private/transcript.jsonl' },
    eventType: 'codex.subagent',
  },
};
const definition = definitions[mode];
if (!definition) throw new Error(`unknown Codex scenario mode: ${mode}`);
// Current official contract: Codex native hook ingestion is deliberately
// trust-gated — the adapter reports the capability as unverified/supported:
// false and the generic normalizer rejects codex_cli payloads outright. The
// fail-closed boundary must never normalize an official-shaped hook into a
// lifecycle event (which could later be mistaken for attested evidence) and
// must never retain or echo sensitive payload fields.
const adapted = adaptCodexHook(definition.providerEvent, definition.payload);
if (!adapted || adapted.supported !== false) {
  throw new Error('unverified Codex hook was accepted as a native capability');
}
const serializedAdapter = JSON.stringify(adapted);
if (
  serializedAdapter.includes('private') ||
  serializedAdapter.includes('codex-session') ||
  serializedAdapter.includes('transcript')
) {
  throw new Error('Codex sensitive payload leaked through the adapter result');
}
const event = normalizeHookEvent({
  provider: 'codex_cli',
  providerEvent: definition.providerEvent,
  input: definition.payload,
  installationId: 'scenario-codex-installation-123',
  deviceId: '11111111-1111-4111-8111-111111111111',
  identifierSecret: 'scenario-codex-device-secret',
  environmentKind: 'sandbox',
  environmentId: 'scenario-codex',
  adapterVersion: 'unverified',
  now: new Date('2026-08-06T00:00:00.000Z'),
});
if (event !== null) throw new Error(`unverified Codex hook normalized into ${event?.eventType ?? 'a lifecycle event'}`);
process.stdout.write(
  `${JSON.stringify([{
    eventId: `scenario-${mode}`,
    eventType: definition.eventType,
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
    metadata: { native: false, rejected: true, reason: adapted.reason },
  }])}\n`,
);
