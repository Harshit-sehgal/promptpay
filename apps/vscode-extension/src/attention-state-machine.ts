export type AttentionState =
  | 'unknown'
  | 'foreground_visible'
  | 'foreground_not_visible'
  | 'background'
  | 'device_locked'
  | 'disconnected';

export type AttentionStateChange = {
  previous: AttentionState;
  current: AttentionState;
  installationId: string;
  ownerId: string;
  occurredAt: number;
  reason: AttentionStateChangeReason;
};

export type AttentionStateChangeReason =
  | 'initial'
  | 'window_focus'
  | 'surface_visibility'
  | 'device_lock'
  | 'bridge_connection'
  | 'reset';

export type AttentionStateMachineOptions = {
  /** Stable local installation identity used to coordinate surfaces. */
  installationId: string;
  /** Stable identity for this VS Code window/surface. */
  ownerId: string;
  now?: () => number;
};

/**
 * Models human attention independently from agent processing and advertising.
 *
 * This class deliberately has no API, detector, ad, or ledger dependencies. A
 * caller must explicitly provide focus, WaitLayer-surface visibility, device
 * lock, and bridge connectivity observations. Missing observations do not get
 * promoted into proof of attention.
 *
 * The owner registry prevents two local VS Code surfaces from claiming
 * foreground attention for the same installation at the same time. A future
 * multi-window coordinator can replace the registry without changing the
 * state contract.
 */
export class AttentionStateMachine {
  private static readonly owners = new Map<string, string>();

  private readonly installationId: string;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly listeners = new Set<(change: AttentionStateChange) => void>();
  private state: AttentionState = 'unknown';
  private focused = false;
  private surfaceVisible = false;
  private locked = false;
  private connected = true;
  private ownsAttention = false;

  constructor(options: AttentionStateMachineOptions) {
    if (!options.installationId.trim()) throw new Error('Attention installationId is required');
    if (!options.ownerId.trim()) throw new Error('Attention ownerId is required');
    this.installationId = options.installationId;
    this.ownerId = options.ownerId;
    this.now = options.now ?? Date.now;
  }

  getState(): AttentionState {
    return this.state;
  }

  getInstallationId(): string {
    return this.installationId;
  }

  getOwnerId(): string {
    return this.ownerId;
  }

  isOwner(): boolean {
    return this.ownsAttention;
  }

  onChange(listener: (change: AttentionStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Update the observed VS Code window focus state. */
  setWindowFocused(focused: boolean): void {
    this.focused = focused;
    this.recompute('window_focus');
  }

  /** Update whether a WaitLayer-owned surface is currently visible. */
  setSurfaceVisible(visible: boolean): void {
    this.surfaceVisible = visible;
    this.recompute('surface_visibility');
  }

  /** Explicit lock signal supplied by a platform integration when available. */
  setDeviceLocked(locked: boolean): void {
    this.locked = locked;
    this.recompute('device_lock');
  }

  /** Update local bridge/integration connectivity. */
  setBridgeConnected(connected: boolean): void {
    this.connected = connected;
    this.recompute('bridge_connection');
  }

  /** Release this owner and return the machine to an unobserved state. */
  reset(): void {
    this.releaseOwner();
    this.focused = false;
    this.surfaceVisible = false;
    this.locked = false;
    this.connected = true;
    this.transition('unknown', 'reset');
  }

  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  private recompute(reason: AttentionStateChangeReason): void {
    const next = this.resolveState();
    if (next === 'foreground_visible') {
      this.acquireOwner();
      if (!this.ownsAttention) {
        this.transition('foreground_not_visible', reason);
        return;
      }
    } else if (this.ownsAttention) {
      this.releaseOwner();
    }
    this.transition(next, reason);
  }

  private resolveState(): AttentionState {
    if (this.locked) return 'device_locked';
    if (!this.connected) return 'disconnected';
    if (!this.focused) return 'background';
    return this.surfaceVisible ? 'foreground_visible' : 'foreground_not_visible';
  }

  private acquireOwner(): void {
    const currentOwner = AttentionStateMachine.owners.get(this.installationId);
    if (currentOwner && currentOwner !== this.ownerId) {
      this.ownsAttention = false;
      return;
    }
    AttentionStateMachine.owners.set(this.installationId, this.ownerId);
    this.ownsAttention = true;
  }

  private releaseOwner(): void {
    if (AttentionStateMachine.owners.get(this.installationId) === this.ownerId) {
      AttentionStateMachine.owners.delete(this.installationId);
    }
    this.ownsAttention = false;
  }

  private transition(current: AttentionState, reason: AttentionStateChangeReason): void {
    if (current === this.state) return;
    const change: AttentionStateChange = {
      previous: this.state,
      current,
      installationId: this.installationId,
      ownerId: this.ownerId,
      occurredAt: this.now(),
      reason,
    };
    this.state = current;
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // Observability consumers must never disrupt attention tracking.
      }
    }
  }
}
