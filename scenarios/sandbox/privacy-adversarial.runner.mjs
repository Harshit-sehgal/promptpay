import { normalizeHookEvent, readHookInputJson } from '../../apps/cli/dist/lib/hook-ingestion.js';

const mode = process.argv[2];
const privateValues = {
  command: 'curl -H Authorization: Bearer secret-token https://private.example',
  path: '/home/alice/private/source.ts',
  transcript: '/home/alice/.claude/transcript.jsonl',
  source: 'const proprietary = true;',
  error: 'Error: token=secret-token at /home/alice/private/source.ts:1:1',
};

const input = {
  eventId: `privacy-${mode}-event`,
  sessionId: `privacy-${mode}-session`,
  occurredAt: '2026-08-06T00:00:00.000Z',
  prompt: `prompt contains ${privateValues.error}`,
  tool_input: { command: privateValues.command },
  cwd: privateValues.path,
  workspacePath: privateValues.path,
  transcript_path: privateValues.transcript,
  sourceCode: privateValues.source,
  error: privateValues.error,
  stack: privateValues.error,
};

if (mode === 'large') {
  const raw = JSON.stringify({ payload: 'x'.repeat(300_000) });
  if (readHookInputJson(raw) !== null) throw new Error('oversized hook input was accepted');
  input.largePayload = 'x'.repeat(300_000);
}
if (mode === 'prototype') {
  Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
  input.metadata = { constructor: { polluted: true }, prototype: { polluted: true } };
}

const event = normalizeHookEvent({
  provider: 'claude_code',
  providerEvent: 'PostToolUseFailure',
  input,
  installationId: `privacy-${mode}-installation`,
  deviceId: `00000000-0000-4000-8000-0000000000${mode === 'command' ? '72' : mode === 'path' ? '73' : mode === 'transcript' ? '74' : mode === 'large' ? '75' : mode === 'prototype' ? '76' : '77'}`,
  environmentKind: 'sandbox',
  environmentId: `scenario-privacy-${mode}`,
  identifierSecret: 'privacy-scenario-secret',
  now: new Date('2026-08-06T00:00:00.000Z'),
});
if (!event) throw new Error(`privacy fixture did not normalize: ${mode}`);
const serialized = JSON.stringify(event);
for (const value of Object.values(privateValues)) {
  if (serialized.includes(value))
    throw new Error(`private ${mode} fixture value survived normalization`);
}
if (
  Object.prototype.hasOwnProperty.call(event, 'metadata') &&
  JSON.stringify(event.metadata).includes('polluted')
)
  throw new Error('prototype-pollution value survived normalization');
process.stdout.write(`${JSON.stringify([{ ...event, mode: 'sandbox', hasCashValue: false }])}\n`);
