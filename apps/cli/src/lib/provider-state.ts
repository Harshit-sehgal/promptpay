import type { AgentEventType } from '@ateva/agent-protocol';

export type ProviderLifecycleState =
  'user_active' | 'ai_processing' | 'tool_processing' | 'user_input_required' | 'idle' | 'unknown';

const STATE_BY_EVENT: Partial<Record<AgentEventType, ProviderLifecycleState>> = {
  'session.started': 'idle',
  'session.resumed': 'idle',
  'session.paused': 'idle',
  'session.ended': 'idle',
  'turn.submitted': 'user_active',
  'turn.processing_started': 'ai_processing',
  'turn.processing_stopped': 'ai_processing',
  'turn.completed': 'idle',
  'turn.failed': 'idle',
  'turn.cancelled': 'idle',
  'tool.started': 'tool_processing',
  'tool.succeeded': 'ai_processing',
  'tool.failed': 'ai_processing',
  'tool.batch_completed': 'ai_processing',
  'input.required': 'user_input_required',
  'input.resolved': 'ai_processing',
  'permission.required': 'user_input_required',
  'permission.allowed': 'ai_processing',
  'permission.denied': 'ai_processing',
  'subagent.started': 'ai_processing',
  'subagent.stopped': 'ai_processing',
  'task.created': 'ai_processing',
  'task.completed': 'ai_processing',
  'task.failed': 'ai_processing',
  'user.interacted': 'user_active',
};

/**
 * Classify a canonical provider event for telemetry. This is deliberately a
 * pure mapping: it does not infer unsupported states and cannot authorize
 * advertising, rewards, or settlement.
 */
export function classifyProviderEvent(eventType: AgentEventType): ProviderLifecycleState {
  return STATE_BY_EVENT[eventType] ?? 'unknown';
}

export function isHumanAttentionEligibleState(state: ProviderLifecycleState): boolean {
  return state === 'ai_processing' || state === 'tool_processing';
}
