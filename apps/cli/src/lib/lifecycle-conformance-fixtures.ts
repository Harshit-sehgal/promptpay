import type { LifecycleConformanceScenario } from './lifecycle-conformance';

const native = 'native_hook' as const;
const observed = 'observed' as const;

function event(
  eventId: string,
  eventType: string,
  occurredAtMs: number,
): LifecycleConformanceScenario['events'][number] {
  return { eventId, eventType, occurredAtMs, sourceType: observed, integrationMode: native };
}

/** Payload-free Claude-shaped lifecycle sequences used by the conformance suite. */
export const CLAUDE_CODE_CONFORMANCE_FIXTURES: readonly LifecycleConformanceScenario[] = [
  {
    id: 'claude-normal-turn',
    expectedEventTypes: ['turn.submitted', 'turn.processing_started', 'input.required'],
    expectedStates: ['user_active', 'ai_processing', 'user_input_required'],
    events: [
      event('normal-1', 'turn.submitted', 0),
      event('normal-2', 'turn.processing_started', 1_000),
      event('normal-3', 'input.required', 4_000),
    ],
    expectedDurationMs: 4_000,
  },
  {
    id: 'claude-sequential-tools',
    expectedEventTypes: [
      'turn.submitted',
      'turn.processing_started',
      'tool.started',
      'tool.succeeded',
      'tool.started',
      'tool.failed',
      'input.required',
    ],
    expectedStates: [
      'user_active',
      'ai_processing',
      'tool_processing',
      'ai_processing',
      'tool_processing',
      'ai_processing',
      'user_input_required',
    ],
    events: [
      event('tools-1', 'turn.submitted', 0),
      event('tools-2', 'turn.processing_started', 100),
      event('tools-3', 'tool.started', 1_000),
      event('tools-4', 'tool.succeeded', 2_000),
      event('tools-5', 'tool.started', 2_100),
      event('tools-6', 'tool.failed', 3_000),
      event('tools-7', 'input.required', 4_000),
    ],
    expectedDurationMs: 4_000,
  },
  {
    id: 'claude-permission-round-trip',
    expectedEventTypes: [
      'turn.processing_started',
      'permission.required',
      'permission.allowed',
      'tool.started',
      'tool.succeeded',
      'input.required',
    ],
    expectedStates: [
      'ai_processing',
      'user_input_required',
      'ai_processing',
      'tool_processing',
      'ai_processing',
      'user_input_required',
    ],
    events: [
      event('permission-1', 'turn.processing_started', 0),
      event('permission-2', 'permission.required', 800),
      event('permission-3', 'permission.allowed', 1_600),
      event('permission-4', 'tool.started', 1_700),
      event('permission-5', 'tool.succeeded', 2_400),
      event('permission-6', 'input.required', 3_000),
    ],
    expectedDurationMs: 3_000,
  },
  {
    id: 'claude-subagent-completion',
    expectedEventTypes: [
      'turn.processing_started',
      'subagent.started',
      'task.created',
      'task.completed',
      'subagent.stopped',
      'input.required',
    ],
    expectedStates: [
      'ai_processing',
      'ai_processing',
      'ai_processing',
      'ai_processing',
      'ai_processing',
      'user_input_required',
    ],
    events: [
      event('subagent-1', 'turn.processing_started', 0),
      event('subagent-2', 'subagent.started', 100),
      event('subagent-3', 'task.created', 200),
      event('subagent-4', 'task.completed', 1_500),
      event('subagent-5', 'subagent.stopped', 1_600),
      event('subagent-6', 'input.required', 2_000),
    ],
    expectedDurationMs: 2_000,
  },
  {
    id: 'claude-cancelled-turn',
    expectedEventTypes: ['turn.submitted', 'turn.processing_started', 'turn.cancelled'],
    expectedStates: ['user_active', 'ai_processing', 'idle'],
    events: [
      event('cancel-1', 'turn.submitted', 0),
      event('cancel-2', 'turn.processing_started', 100),
      event('cancel-3', 'turn.cancelled', 900),
    ],
    expectedDurationMs: 900,
  },
] as const;
