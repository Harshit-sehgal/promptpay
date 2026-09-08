import { describe, expect, it } from 'vitest';

import { classifyProviderEvent, isHumanAttentionEligibleState } from './provider-state';

describe('provider lifecycle state classification', () => {
  it('distinguishes user, model, tool, input-required, and idle states', () => {
    expect(classifyProviderEvent('turn.submitted')).toBe('user_active');
    expect(classifyProviderEvent('turn.processing_started')).toBe('ai_processing');
    expect(classifyProviderEvent('tool.started')).toBe('tool_processing');
    expect(classifyProviderEvent('permission.required')).toBe('user_input_required');
    expect(classifyProviderEvent('turn.completed')).toBe('idle');
  });

  it('treats only processing states as attention-eligible telemetry', () => {
    expect(isHumanAttentionEligibleState('ai_processing')).toBe(true);
    expect(isHumanAttentionEligibleState('tool_processing')).toBe(true);
    expect(isHumanAttentionEligibleState('user_active')).toBe(false);
    expect(isHumanAttentionEligibleState('user_input_required')).toBe(false);
    expect(isHumanAttentionEligibleState('idle')).toBe(false);
    expect(isHumanAttentionEligibleState('unknown')).toBe(false);
  });
});
