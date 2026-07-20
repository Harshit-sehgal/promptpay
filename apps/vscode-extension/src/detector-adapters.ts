import type { WaitSignal } from './wait-detector';

/**
 * P1.15 — Tool-specific detector adapters.
 *
 * The monolithic `mapToolToSignals` switch has been decomposed into one
 * `DetectorAdapter` per wait cause. Each adapter owns its tool identifier, the
 * canonical signal(s) it emits, and a `matches()` predicate so new tools
 * (claude-code, cursor, codex, terminal, …) can be added without touching the
 * detector core. Resolution falls back to an `inactivity` adapter that NEVER
 * emits `ai_generation`, so a misclassified wait can never inflate the
 * server's wait confidence.
 */
export interface DetectorAdapter {
  /** Canonical tool identifier this adapter owns (e.g. 'claude'). */
  readonly tool: string;
  /** The signals this adapter emits when its wait fires. */
  readonly signals: WaitSignal[];
  /** Whether this adapter handles the given wait cause / tool name. */
  matches(toolName: string): boolean;
  /**
   * When true, waits produced by this adapter are "shadow" detections: kept
   * local and excluded from monetization until corroborated by a stronger
   * signal. Set for weak heuristics (e.g. generic inactivity) whose only
   * signal is `inactivity` and which are NOT reliable proof of AI generation.
   */
  readonly shadowOnly?: boolean;
}

/** A static adapter: fixed tool set, fixed signal list. */
class StaticAdapter implements DetectorAdapter {
  constructor(
    public readonly tool: string,
    public readonly signals: WaitSignal[],
    private readonly aliases: string[] = [],
    public readonly shadowOnly: boolean = false,
  ) {}

  matches(toolName: string): boolean {
    return toolName === this.tool || this.aliases.includes(toolName);
  }
}

/** AI-assistant tools that must map to `ai_generation`. */
export const AI_TOOL_VALUES = ['codex', 'cline', 'aider', 'claude', 'cursor'] as const;

export const claudeCodeAdapter = new StaticAdapter(
  'claude',
  [{ type: 'ai_generation' }],
  ['claude'],
);
export const cursorAdapter = new StaticAdapter('cursor', [{ type: 'ai_generation' }], ['cursor']);
export const codexAdapter = new StaticAdapter('codex', [{ type: 'ai_generation' }], ['codex']);
export const clineAdapter = new StaticAdapter('cline', [{ type: 'ai_generation' }], ['cline']);
export const aiderAdapter = new StaticAdapter('aider', [{ type: 'ai_generation' }], ['aider']);
export const terminalAdapter = new StaticAdapter('terminal', [{ type: 'lifecycle_event' }]);
export const taskAdapter = new StaticAdapter('task', [{ type: 'active_task' }]);
export const inactivityAdapter = new StaticAdapter(
  'inactivity',
  [{ type: 'inactivity' }],
  [],
  true,
);
export const manualAiAdapter = new StaticAdapter(
  'ai',
  [{ type: 'ai_generation' }],
  ['ai', 'manual'],
);

/** Fallback adapter — NEVER emits `ai_generation`. Shadow-only (weak heuristic). */
export const defaultAdapter = new StaticAdapter('unknown', [{ type: 'inactivity' }], [], true);

/**
 * Ordered adapter registry. `manualAiAdapter` is first so its `ai`/`manual`
 * aliases resolve before the generic AI set; `inactivityAdapter` is last among
 * the explicit set so an unmatched tool drops through to `defaultAdapter`.
 */
export const DETECTOR_ADAPTERS: DetectorAdapter[] = [
  manualAiAdapter,
  claudeCodeAdapter,
  cursorAdapter,
  codexAdapter,
  clineAdapter,
  aiderAdapter,
  terminalAdapter,
  taskAdapter,
  inactivityAdapter,
];

/** Resolve the adapter responsible for a wait cause, falling back to inactivity. */
export function resolveAdapter(tool: string, disabled?: readonly string[]): DetectorAdapter {
  const adapter = DETECTOR_ADAPTERS.find((a) => a.matches(tool)) ?? defaultAdapter;
  // Per-source kill switch (P1.17/P1.18): a disabled source must never emit
  // strong signals, so fall back to the default adapter (shadow-only, never
  // ai_generation) when the resolved adapter's source is in the disabled set.
  if (disabled && disabled.length > 0) {
    const normalized = adapter.tool.toLowerCase();
    if (disabled.some((s) => s.toLowerCase() === normalized)) {
      return defaultAdapter;
    }
  }
  return adapter;
}

/** Maps a wait cause to its canonical signal(s). Preserves the prior contract. */
export function mapToolToSignals(tool: string, disabled?: readonly string[]): WaitSignal[] {
  return resolveAdapter(tool, disabled).signals;
}
