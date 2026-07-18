import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  taskStart: undefined as ((event: unknown) => void) | undefined,
  taskEnd: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock('vscode', () => ({
  workspace: { onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })) },
  window: {
    onDidChangeWindowState: vi.fn(() => ({ dispose: vi.fn() })),
    onDidOpenTerminal: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    terminals: [],
    activeTextEditor: undefined,
  },
  tasks: {
    onDidStartTask: vi.fn((listener: (event: unknown) => void) => {
      mock.taskStart = listener;
      return { dispose: vi.fn() };
    }),
    onDidEndTask: vi.fn((listener: (event: unknown) => void) => {
      mock.taskEnd = listener;
      return { dispose: vi.fn() };
    }),
  },
}));

import {
  DETECTOR_VERSION,
  mapToolToSignals,
  WaitStateDetector,
  WaitStateEvent,
} from './wait-detector';

describe('WaitStateDetector — categorized signals', () => {
  let detector: WaitStateDetector;

  beforeEach(() => {
    mock.taskStart = undefined;
    mock.taskEnd = undefined;
    detector = new WaitStateDetector({ getInactivityTimeoutMs: () => 15_000 });
  });

  /** Triggers a manual wait and returns the emitted wait_start event. */
  function captureWaitStart(tool: string): WaitStateEvent {
    const events: WaitStateEvent[] = [];
    detector.onWaitStateStart((e) => events.push(e));
    detector.triggerManualWait(tool);
    return events[0];
  }

  it('maps an inactivity wait to an inactivity signal (never ai_generation)', () => {
    const event = captureWaitStart('inactivity');
    expect(event.signals).toEqual([{ type: 'inactivity' }]);
  });

  it('maps a task wait to an active_task signal', () => {
    const event = captureWaitStart('task');
    expect(event.signals).toEqual([{ type: 'active_task' }]);
  });

  it('maps an AI-tool manual wait (e.g. codex) to an ai_generation signal', () => {
    const event = captureWaitStart('codex');
    expect(event.signals).toEqual([{ type: 'ai_generation' }]);
  });

  it('carries a non-empty DETECTOR_VERSION on the emitted event', () => {
    const event = captureWaitStart('task');
    expect(typeof event.detectorVersion).toBe('string');
    expect(event.detectorVersion).toBe(DETECTOR_VERSION);
    expect(event.detectorVersion.length).toBeGreaterThan(0);
  });

  it('falls back to inactivity (never ai_generation) for unknown/empty tools', () => {
    expect(mapToolToSignals('')).toEqual([{ type: 'inactivity' }]);
    expect(mapToolToSignals('some-unknown-tool')).toEqual([{ type: 'inactivity' }]);
    // terminal maps to lifecycle_event, not ai_generation
    expect(mapToolToSignals('terminal')).toEqual([{ type: 'lifecycle_event' }]);
  });

  it('maps other known AI tools (cline, aider, claude, cursor, ai, manual) to ai_generation', () => {
    for (const tool of ['cline', 'aider', 'claude', 'cursor', 'ai', 'manual']) {
      expect(mapToolToSignals(tool)).toEqual([{ type: 'ai_generation' }]);
    }
  });
});
