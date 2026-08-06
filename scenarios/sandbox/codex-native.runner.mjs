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
const adapted = adaptCodexHook(definition.providerEvent, definition.payload);
if (!adapted) throw new Error('official-shaped Codex hook was rejected');
const event = normalizeHookEvent({
  provider: 'codex_cli',
  providerEvent: adapted.providerEvent,
  input: adapted.input,
  installationId: 'scenario-codex-installation-123',
  deviceId: '11111111-1111-4111-8111-111111111111',
  identifierSecret: 'scenario-codex-device-secret',
  environmentKind: 'sandbox',
  environmentId: 'scenario-codex',
  adapterVersion: adapted.adapterVersion,
  now: new Date('2026-08-06T00:00:00.000Z'),
});
if (!event || event.eventType !== definition.expected) throw new Error(`Codex event normalized as ${event?.eventType ?? 'null'}`);
const serialized = JSON.stringify(event);
if (serialized.includes('private') || serialized.includes('codex-session') || serialized.includes('transcript')) throw new Error('Codex sensitive payload leaked');
process.stdout.write(`${JSON.stringify([{ eventId: `scenario-${mode}`, eventType: definition.eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata: { normalizedEventType: event.eventType, native: true } }])}\n`);
