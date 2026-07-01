import * as vscode from 'vscode';

export interface WaitStateEvent {
  startTime: number;
  durationMs: number;
  tool: string;
}

/**
 * Detects "wait states" when AI coding assistants appear to be thinking.
 *
 * Heuristics:
 *  - GitHub Copilot / Cursor / Copilot Chat: status bar shows "Working..." or
 *    channel updates with progress messages
 *  - Comments in chat that indicate generation in progress
 *  - Extensions may emit progress events
 *
 * Implementation: poll key status bar text and listen for relevant chat
 * events. Fires waitStateStart when a long-running operation begins.
 */
export class WaitStateDetector {
  private listeners: Array<(e: WaitStateEvent) => void> = [];
  private watch?: NodeJS.Timeout;
  private lastStatus = '';
  private inWait = false;
  private waitStart = 0;

  // Triggers for "the AI is thinking" status messages
  private readonly WAIT_PATTERNS = [
    /generating/i,
    /^working/i,
    /thinking/i,
    /processing/i,
    /waiting for/i,
    /(cursor|copilot|claude).*(running|thinking)/i,
  ];

  onWaitStateStart(fn: (e: WaitStateEvent) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  start(context: vscode.ExtensionContext) {
    this.watch = setInterval(() => this.checkStatusBar(), 1000);

    context.subscriptions.push({
      dispose: () => {
        if (this.watch) clearInterval(this.watch);
      },
    });
  }

  private checkStatusBar() {
    const status = vscode.window?.state ? '' : ''; // placeholder
    // Inspect all status bar items
    const editorStatus = (vscode.window as any).statusBar?.text || '';
    const combined = `${lastStatusCache} ${editorStatus}`.trim();

    if (!combined) return;

    const matches = this.WAIT_PATTERNS.some((p) => p.test(combined));

    if (matches && !this.inWait) {
      this.inWait = true;
      this.waitStart = Date.now();
    } else if (!matches && this.inWait) {
      const durationMs = Date.now() - this.waitStart;
      this.inWait = false;

      // Only fire if wait was meaningful (>2s) — short flickers are noise
      if (durationMs >= 2000) {
        this.notify({
          startTime: this.waitStart,
          durationMs,
          tool: 'vscode',
        });
      }
    }

    lastStatusCache = combined.slice(-120);
  }

  private notify(event: WaitStateEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* never let a listener disrupt detector */
      }
    }
  }
}

let lastStatusCache = '';
