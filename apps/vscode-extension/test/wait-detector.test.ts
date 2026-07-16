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

import { WaitStateDetector } from '../src/wait-detector';

describe('WaitStateDetector', () => {
  let detector: WaitStateDetector;

  beforeEach(() => {
    mock.taskStart = undefined;
    mock.taskEnd = undefined;
    detector = new WaitStateDetector({ getInactivityTimeoutMs: () => 15_000 });
  });

  it('emits a wait_start signal with a generated id when a wait begins', () => {
    const signals: string[] = [];
    const onStart = vi.fn((e: { waitStateId: string; tool: string }) => {
      signals.push('start');
      expect(e.waitStateId.startsWith('ws_')).toBe(true);
      expect(e.tool).toBe('manual-tool');
    });

    detector.onWaitStateStart(onStart);
    const id = detector.triggerManualWait('manual-tool');

    expect(id.startsWith('ws_')).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(signals).toEqual(['start']);
  });

  it('emits wait_end for every started wait — including short flickers', () => {
    // Every wait_start is persisted server-side as a wait_state_start row, so
    // suppressing wait_end for sub-2s waits was orphaning start rows with no
    // matching end row and no server-computed duration. endWait now always
    // emits so each started wait is paired with an end.
    const ended: number[] = [];
    detector.onWaitStateStart(() => {});
    detector.onSignal((s) => {
      if (s.type === 'wait_end') ended.push(s.event.durationMs);
    });

    detector.triggerManualWait('short');
    detector.endManualWait(); // duration ~0ms → still emits to close the row
    expect(ended).toHaveLength(1);

    const start = Date.now();
    detector.triggerManualWait('long');
    // Busy-wait past the 2s meaningful-wait threshold so the duration is real.
    while (Date.now() - start < 2_100) {}
    detector.endManualWait();
    expect(ended).toHaveLength(2);
    expect(ended[1]).toBeGreaterThanOrEqual(2_000);
  });

  it('does not stack concurrent waits — a single waitStateId is returned', () => {
    const onStart = vi.fn();
    detector.onWaitStateStart(onStart);

    const id1 = detector.triggerManualWait('tool');
    const id2 = detector.triggerManualWait('tool');

    expect(id1).toBe(id2);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('ends a task wait shorter than two seconds and accepts the next wait', () => {
    const starts = vi.fn();
    const ends = vi.fn();
    const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
    detector.onWaitStateStart(starts);
    detector.onSignal((signal) => {
      if (signal.type === 'wait_end') ends(signal.event);
    });
    detector.start(context);

    mock.taskStart?.({});
    mock.taskEnd?.({});

    expect(starts).toHaveBeenCalledTimes(1);
    expect(ends).toHaveBeenCalledTimes(1);
    expect(ends.mock.calls[0][0].durationMs).toBeLessThan(2_000);

    detector.triggerManualWait('manual-after-short-task');
    expect(starts).toHaveBeenCalledTimes(2);

    for (const disposable of context.subscriptions) disposable.dispose();
  });
});
