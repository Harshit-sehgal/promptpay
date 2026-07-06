import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface WaitStateDetectorOptions {
  /** Callback to read the configurable inactivity timeout (ms). Default 15_000. */
  getInactivityTimeoutMs: () => Promise<number> | number;
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
  | { type: 'wait_start'; event: WaitStateEvent }
  | { type: 'wait_end'; event: WaitStateEvent };

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
  private getInactivityTimeoutMs: () => Promise<number> | number;

  /** User must be idle this long (with window focused) before we infer a wait. */
  private readonly inactivityThresholdMs = 15_000;
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
        } else {
          // Extend the wait check — a single edit doesn't cancel it yet.
          // The next checkInactivity cycle will re-evaluate.
        }
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
    const taskStartListener = vscode.tasks.onDidStartTask((e) => {
      this.activeTaskCount++;
      if (this.activeTaskCount === 1 && !this.inWait) {
        this.enterWait('task');
        this.taskWaitStart = Date.now();
      }
    });
    const taskEndListener = vscode.tasks.onDidEndTask((e) => {
      this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
      if (this.activeTaskCount === 0 && this.inWait && this.taskWaitStart > 0) {
        const duration = Date.now() - this.taskWaitStart;
        this.taskWaitStart = 0;
        if (duration >= 2_000) {
          this.endWait();
        }
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
      // Terminal burst activity often precedes AI output
      if (!this.inWait) {
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

  private trackTerminal(terminal: vscode.Terminal) {
    // We can't read terminal output directly, but we can track its process ID
    // and watch for terminal state changes via the creation/destruction lifecycle
    this.lastTerminalActiveTime = Date.now();
  }

  private scheduleInactivityCheck() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    // Reset the edit-burst counter on each scheduling cycle — any
    // accumulated edit count from the previous window is stale.
    this.editsDuringWait = 0;
    this.inactivityTimer = setTimeout(async () => {
      const threshold = await this.getInactivityTimeoutMs();
      this.checkInactivity(threshold);
    }, this.inactivityThresholdMs);
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

    // Only fire if wait was meaningful (>2s) — short flickers are noise
    if (durationMs >= 2_000) {
      const event: WaitStateEvent = {
        startTime: this.waitStart,
        durationMs,
        tool: 'vscode',
        waitStateId: this.waitStateId,
      };

      this.emitSignal({ type: 'wait_end', event });
    }

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
