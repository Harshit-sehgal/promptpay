import * as crypto from 'crypto';
import * as vscode from 'vscode';

export interface WaitStateDetectorOptions {
  /** Callback to read the configurable inactivity timeout (ms). Default 15_000. */
  getInactivityTimeoutMs: () => number;
}

export interface WaitStateEvent {
  startTime: number;
  durationMs: number;
  tool: string;
  waitStateId: string;
}

/**
 * Signals that are emitted during wait-state lifecycle.
 */
export type DetectorSignal =
  { type: 'wait_start'; event: WaitStateEvent } | { type: 'wait_end'; event: WaitStateEvent };

/**
 * Detects "wait states" when AI coding assistants appear to be thinking.
 *
 * VS Code API constraints: extensions cannot read other extensions' status bar
 * items, nor read arbitrary terminal output. So we use a multi-signal approach:
 *
 *  1. Editor inactivity — if the user has stopped typing for a threshold
 *     while the window is focused, it likely means they are reading AI output.
 *  2. Window state — when the user returns to VS Code after a brief switch
 *     away, they were probably waiting for AI elsewhere.
 *  3. Task execution — AI extensions often register tasks; task start/end
 *     gives a strong signal.
 *  4. Own status bar item — our extension's status bar text is the only text
 *     we control, but we can watch for other extensions updating their items
 *     indirectly via the editor/terminal state changes they trigger.
 *
 * Frequency caps and quiet hours are enforced externally (in extension.ts),
 * so the detector fires unfiltered — the caller applies policy.
 */
export class WaitStateDetector {
  private listeners: Array<(e: WaitStateEvent) => void> = [];
  private signalListeners: Array<(s: DetectorSignal) => void> = [];
  private disposables: vscode.Disposable[] = [];

  // ── Editor inactivity tracking ──
  private inactivityTimer?: NodeJS.Timeout;
  private lastEditTime = 0;
  private getInactivityTimeoutMs: () => number;

  /** Tracks whether we are currently inside an inferred wait state. */
  private inWait = false;
  private waitStart = 0;
  private waitStateId = '';
  private windowFocused = true;
  /** Tracks consecutive "human-like" edit count during a wait — a single
   *  programmatic insertion (AI inline completion) does NOT terminate the
   *  wait; multiple edits in quick succession (real user typing) do. */
  private editsDuringWait = 0;

  // ── Task monitoring ──
  private activeTaskCount = 0;
  private taskWaitStart = 0;

  // ── Terminal activity detection ──
  // We track when terminals are opened/closed and watch for AI tool names
  private terminalWriteCounts = new Map<string, number>();
  private lastTerminalActiveTime = 0;

  constructor(options?: WaitStateDetectorOptions) {
    this.getInactivityTimeoutMs = options?.getInactivityTimeoutMs ?? (() => 15_000);
  }

  onWaitStateStart(fn: (e: WaitStateEvent) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  onSignal(fn: (s: DetectorSignal) => void) {
    this.signalListeners.push(fn);
    return () => {
      this.signalListeners = this.signalListeners.filter((l) => l !== fn);
    };
  }

  start(context: vscode.ExtensionContext) {
    // ── 1. Editor change tracking ──
    this.lastEditTime = Date.now();
    const editListener = vscode.workspace.onDidChangeTextDocument((e) => {
      // Only file/untitled documents — ignore output/terminal schemes.
      if (!(e.document.uri.scheme === 'file' || e.document.uri.scheme === 'untitled')) return;

      // Update baseline even during a wait — this moves the idle clock.
      this.lastEditTime = Date.now();

      if (this.inWait) {
        // A single edit could be an AI inline completion (programmatic).
        // Require a burst of human edits (~3 or more) in quick succession
        // before concluding that the user resumed typing. Every edit
        // increments a counter; when it reaches the burst threshold we
        // end the wait. The counter decays after a short window so
        // scattered single insertions don't accumulate.
        this.editsDuringWait++;
        if (this.editsDuringWait >= 3) {
          this.endWait();
        }
      } else {
        this.scheduleInactivityCheck();
      }
    });
    this.disposables.push(editListener);

    // ── 2. Window focus tracking ──
    const windowListener = vscode.window.onDidChangeWindowState((state) => {
      this.windowFocused = state.focused;
      if (state.focused) {
        // User came back — reset inactivity baseline
        this.lastEditTime = Date.now();
        // If we were in a wait, check if still waiting
        if (this.inWait) {
          this.scheduleInactivityCheck();
        }
      }
    });
    this.disposables.push(windowListener);

    // ── 3. Task execution monitoring ──
    const taskStartListener = vscode.tasks.onDidStartTask((_e) => {
      this.activeTaskCount++;
      if (this.activeTaskCount === 1 && !this.inWait) {
        this.enterWait('task');
        this.taskWaitStart = Date.now();
      }
    });
    const taskEndListener = vscode.tasks.onDidEndTask((_e) => {
      this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
      if (this.activeTaskCount === 0 && this.inWait && this.taskWaitStart > 0) {
        this.taskWaitStart = 0;
        // A task start always enters a wait, so its matching task end must
        // always leave it. Filtering short waits here left `inWait` stuck and
        // prevented every later task/manual wait from starting.
        this.endWait();
      }
    });
    this.disposables.push(taskStartListener, taskEndListener);

    // ── 4. Terminal monitoring ──
    // Watch for new terminals and track when they are created/hidden
    vscode.window.terminals.forEach((t) => {
      this.trackTerminal(t);
    });
    const termOpenListener = vscode.window.onDidOpenTerminal((t) => {
      this.trackTerminal(t);
    });
    const termCloseListener = vscode.window.onDidCloseTerminal((_) => {
      // Terminal burst activity often precedes AI output. Only treat it as a
      // wait when the user is actually coding (a focused, active text editor)
      // — otherwise terminal-only work (builds, logs, shells) would wrongly
      // trigger ads. This ties the terminal signal to a real coding context.
      if (!this.inWait && this.windowFocused && vscode.window.activeTextEditor) {
        this.enterWait('terminal');
        // Short wait — terminal activity bursts are brief
        setTimeout(() => {
          if (this.inWait && this.waitStart > 0) {
            this.endWait();
          }
        }, 3_000);
      }
    });
    this.disposables.push(termOpenListener, termCloseListener);

    // ── 5. Active editor change (user switching contexts) ──
    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((_) => {
      // Switching editors often means the user is navigating while AI works
      this.lastEditTime = Date.now();
      this.scheduleInactivityCheck();
    });
    this.disposables.push(editorChangeListener);

    // ── Start the main inactivity polling loop ──
    this.scheduleInactivityCheck();

    context.subscriptions.push({
      dispose: () => {
        for (const d of this.disposables) d.dispose();
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
      },
    });
  }

  /** Public method to manually trigger a wait from a command */
  triggerManualWait(tool: string): string {
    return this.enterWait(tool);
  }

  /** Public method to manually end a wait */
  endManualWait(): void {
    if (this.inWait) {
      this.endWait();
    }
  }

  // ── Private implementation ──

  private trackTerminal(_terminal: vscode.Terminal) {
    // We can't read terminal output directly, but we can track its process ID
    // and watch for terminal state changes via the creation/destruction lifecycle
    this.lastTerminalActiveTime = Date.now();
  }

  private scheduleInactivityCheck() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    // Reset the edit-burst counter on each scheduling cycle — any
    // accumulated edit count from the previous window is stale.
    this.editsDuringWait = 0;

    let threshold = 15_000;
    try {
      threshold = this.getInactivityTimeoutMs();
    } catch {
      // Fallback to default
    }
    this.inactivityTimer = setTimeout(() => {
      this.checkInactivity(threshold);
    }, threshold);
  }

  private checkInactivity(inactivityThresholdMs: number) {
    if (!this.windowFocused) return;
    if (this.inWait) return;

    const idleTime = Date.now() - this.lastEditTime;
    // Must have an active text editor (user is actually coding, not idle browsing)
    const editor = vscode.window.activeTextEditor;

    if (editor && idleTime >= inactivityThresholdMs) {
      // User has stopped typing for 4+ seconds while editor is open and focused.
      // This is a strong signal that AI is generating/thinking.
      this.enterWait('inactivity');
    }

    // Re-schedule for the next check cycle
    this.scheduleInactivityCheck();
  }

  private enterWait(tool: string): string {
    if (this.inWait) {
      // Already in a wait — don't stack
      return this.waitStateId;
    }

    this.inWait = true;
    this.waitStart = Date.now();
    this.waitStateId = generateWaitStateId();

    const event: WaitStateEvent = {
      startTime: this.waitStart,
      durationMs: 0, // updated at end
      tool,
      waitStateId: this.waitStateId,
    };

    // Emit signal for external listeners (extension.ts uses onWaitStateStart)
    this.emitSignal({ type: 'wait_start', event });
    this.notify(event);

    return this.waitStateId;
  }

  private endWait() {
    if (!this.inWait) return;

    const durationMs = Date.now() - this.waitStart;
    this.inWait = false;

    // Always emit the wait_end signal. extension.ts calls waitStateStart() on
    // every wait_start, so suppressing wait_end for short (<2s) "flickers" was
    // orphaning a wait_state_start row on the server with no matching end row
    // and no server-computed duration — a steadily-growing analytics gap. The
    // server applies its own WAIT_STATE_DURATION_TOLERANCE_SECONDS /
    // WAIT_STATE_MAX_DURATION_SECONDS validation on the end event, so a
    // legitimately short wait still records cleanly, including duration 0.
    const event: WaitStateEvent = {
      startTime: this.waitStart,
      durationMs,
      tool: 'vscode',
      waitStateId: this.waitStateId,
    };

    this.emitSignal({ type: 'wait_end', event });

    this.waitStart = 0;
    this.waitStateId = '';
    this.lastEditTime = Date.now();
  }

  private emitSignal(signal: DetectorSignal) {
    for (const l of this.signalListeners) {
      try {
        l(signal);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[WaitLayer] Detector signal listener error: ${msg}`);
        /* never let a listener disrupt detector */
      }
    }
  }

  private notify(event: WaitStateEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[WaitLayer] Detector listener error: ${msg}`);
        /* never let a listener disrupt detector */
      }
    }
  }
}

function generateWaitStateId(): string {
  return `ws_${crypto.randomUUID()}`;
}
