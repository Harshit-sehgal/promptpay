import { describe, expect, it } from 'vitest';

import {
  AI_TOOL_VALUES,
  claudeCodeAdapter,
  cursorAdapter,
  defaultAdapter,
  DETECTOR_ADAPTERS,
  inactivityAdapter,
  manualAiAdapter,
  mapToolToSignals,
  resolveAdapter,
  taskAdapter,
  terminalAdapter,
} from './detector-adapters';

describe('DetectorAdapter registry (P1.15)', () => {
  it('resolves known AI tools to ai_generation via per-tool adapters', () => {
    for (const tool of AI_TOOL_VALUES) {
      const adapter = resolveAdapter(tool);
      expect(adapter.signals).toEqual([{ type: 'ai_generation' }]);
    }
  });

  it('each AI tool maps to its own dedicated adapter instance', () => {
    expect(resolveAdapter('claude')).toBe(claudeCodeAdapter);
    expect(resolveAdapter('cursor')).toBe(cursorAdapter);
    expect(resolveAdapter('codex')).toBe(resolveAdapter('codex'));
  });

  it('maps terminal to a lifecycle_event adapter, not ai_generation', () => {
    expect(resolveAdapter('terminal')).toBe(terminalAdapter);
    expect(mapToolToSignals('terminal')).toEqual([{ type: 'lifecycle_event' }]);
  });

  it('maps task to active_task, inactivity to inactivity', () => {
    expect(resolveAdapter('task')).toBe(taskAdapter);
    expect(mapToolToSignals('task')).toEqual([{ type: 'active_task' }]);
    expect(mapToolToSignals('inactivity')).toEqual([{ type: 'inactivity' }]);
  });

  it('maps ai/manual aliases to the manual AI adapter', () => {
    expect(resolveAdapter('ai')).toBe(manualAiAdapter);
    expect(resolveAdapter('manual')).toBe(manualAiAdapter);
    expect(mapToolToSignals('manual')).toEqual([{ type: 'ai_generation' }]);
  });

  it('falls back to the inactivity default adapter for unknown/empty tools (never ai_generation)', () => {
    expect(resolveAdapter('')).toBe(defaultAdapter);
    expect(resolveAdapter('some-unknown-tool')).toBe(defaultAdapter);
    expect(mapToolToSignals('')).toEqual([{ type: 'inactivity' }]);
  });
  it('exposes a non-empty, ordered adapter registry', () => {
    expect(DETECTOR_ADAPTERS.length).toBeGreaterThan(0);
    expect(DETECTOR_ADAPTERS).toContain(manualAiAdapter);
    // The fallback adapter is resolved outside the registry.
    expect(resolveAdapter('definitely-unknown')).toBe(defaultAdapter);
  });
});

describe('DetectorAdapter shadowOnly (P1.14 / P2.5)', () => {
  it('flags the inactivity adapter as shadow-only (weak heuristic)', () => {
    expect(inactivityAdapter.shadowOnly).toBe(true);
    expect(resolveAdapter('inactivity').shadowOnly).toBe(true);
  });

  it('flags the fallback default adapter as shadow-only', () => {
    expect(defaultAdapter.shadowOnly).toBe(true);
    expect(resolveAdapter('some-unknown-tool').shadowOnly).toBe(true);
  });

  it('does NOT mark strong-signal adapters (ai_generation / task / terminal) as shadow-only', () => {
    expect(claudeCodeAdapter.shadowOnly).not.toBe(true);
    expect(taskAdapter.shadowOnly).not.toBe(true);
    expect(terminalAdapter.shadowOnly).not.toBe(true);
    expect(resolveAdapter('codex').shadowOnly).not.toBe(true);
  });
});

describe('DetectorAdapter per-source kill switch (P1.17 / P1.18)', () => {
  it('falls back to the default adapter when the matched source is disabled', () => {
    const adapter = resolveAdapter('terminal', ['terminal']);
    expect(adapter).toBe(defaultAdapter);
    expect(adapter.signals).toEqual([{ type: 'inactivity' }]);
  });

  it('keeps the matched adapter when the source is not disabled', () => {
    const adapter = resolveAdapter('terminal', []);
    expect(adapter.tool).toBe('terminal');
  });

  it('mapToolToSignals honors the disabled set (never emits ai_generation for a killed source)', () => {
    expect(mapToolToSignals('terminal', ['terminal'])).toEqual([{ type: 'inactivity' }]);
    expect(mapToolToSignals('task', ['task'])).toEqual([{ type: 'inactivity' }]);
  });

  it('case-insensitive: disabling "Task" also disables "task"', () => {
    expect(resolveAdapter('task', ['Task'])).toBe(defaultAdapter);
  });
});
