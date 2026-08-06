import { normalizeHookEvent } from '../../apps/cli/dist/lib/hook-ingestion.js';
import { createGenericWrapperEvent } from '../../apps/cli/dist/lib/generic-wrapper-adapter.js';

const mode = process.argv[2];
const base = {
  event_id: `terminal-${mode}-event`,
  session_id: `terminal-${mode}-session`,
  timestamp: '2026-08-06T00:00:00.000Z',
  tool_name: 'Bash',
  success: mode !== 'failure',
};

let event;
if (mode === 'cancelled') {
  event = createGenericWrapperEvent({
    installationId: 'terminal-cancelled-installation',
    deviceId: '00000000-0000-4000-8000-000000000019',
    correlationId: 'terminal-cancelled-correlation',
    executable: '/usr/local/bin/claude',
    eventType: 'turn.cancelled',
    signal: 'SIGINT',
    occurredAt: new Date('2026-08-06T00:00:00.000Z'),
  });
} else {
  const providerEvent = mode === 'permission'
    ? 'PermissionRequest'
    : mode === 'subagent'
      ? 'SubagentStart'
      : 'PostToolUseFailure';
  event = normalizeHookEvent({
    provider: 'claude_code',
    providerEvent,
    input: {
      ...base,
      ...(mode === 'permission'
        ? { permission_mode: 'default' }
        : mode === 'subagent'
          ? { agent_id: 'subagent-1', subagent_count: 1 }
        : { failure_category: 'tool_error' }),
    },
    installationId: `terminal-${mode}-installation`,
    deviceId: `00000000-0000-4000-8000-0000000000${mode === 'permission' ? '08' : '09'}`,
    environmentKind: 'sandbox',
    environmentId: `scenario-terminal-${mode}`,
    identifierSecret: 'terminal-scenario-secret',
    now: new Date('2026-08-06T00:00:00.000Z'),
  });
}

if (!event) throw new Error(`terminal lifecycle fixture did not normalize: ${mode}`);
process.stdout.write(`${JSON.stringify([{ ...event, mode: 'sandbox', hasCashValue: false }])}\n`);
