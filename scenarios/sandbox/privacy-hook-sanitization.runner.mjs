import { normalizeHookEvent } from '../../apps/cli/dist/lib/hook-ingestion.js';

const planted = {
  prompt: 'fix this with apiKey=sk-live-should-never-leave-device',
  tool_input: { command: 'cat /home/alice/private/source.ts' },
  transcript_path: '/home/alice/.claude/transcript.jsonl',
  cwd: '/home/alice/workspace',
  sourceCode: 'const proprietary = true;',
  apiKey: 'sk-live-should-never-leave-device',
};

const event = normalizeHookEvent({
  provider: 'claude_code',
  providerEvent: 'PreToolUse',
  input: {
    ...planted,
    eventId: 'privacy-scenario-event',
    sessionId: 'privacy-session',
    toolFamily: 'shell',
    occurredAt: '2026-08-06T00:00:00.000Z',
  },
  installationId: 'privacy-installation-v1',
  deviceId: '00000000-0000-4000-8000-000000000071',
  environmentKind: 'sandbox',
  environmentId: 'scenario-privacy',
  identifierSecret: 'privacy-scenario-secret',
  now: new Date('2026-08-06T00:00:00.000Z'),
});

if (!event) throw new Error('hook normalizer rejected the valid provider fixture');
const serialized = JSON.stringify(event);
for (const value of Object.values(planted)) {
  if (serialized.includes(typeof value === 'string' ? value : JSON.stringify(value)))
    throw new Error('privacy fixture value survived normalization');
}

process.stdout.write(`${JSON.stringify([{ ...event, mode: 'sandbox', hasCashValue: false }])}\n`);
