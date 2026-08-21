export type AttentionState =
  | 'unknown'
  | 'foreground_visible'
  | 'foreground_not_visible'
  | 'background'
  | 'device_locked'
  | 'disconnected';

/** A time-bounded ownership claim for one installation. */
type OwnerRecord = {
  ownerId: string;
  leasedUntil: number;
};

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
  | 'reset'
  | 'promotion';

export type AttentionStateMachineOptions = {
  /** Stable local installation identity used to coordinate surfaces. */
  installationId: string;
  /** Stable identity for this VS Code window/surface. */
  ownerId: string;
  now?: () => number;
  /**
   * How long an attention claim stays valid without a refresh. A surface
   * that crashes (or a window that is hard-killed) can never release its
   * owner slot otherwise, stalling every other surface's promotion queue.
   * Defaults to 60 seconds; refreshed on every observation recompute.
   */
  leaseMs?: number;
};

/**
 * Models human attention independently from agent processing and advertising.
 *
 * This class deliberately has no API, detector, ad, or ledger dependencies. A
 * caller must explicitly provide focus, Ateva-surface visibility, device
 * lock, and bridge connectivity observations. Missing observations do not get
 * promoted into proof of attention.
 *
 * The owner registry prevents two local VS Code surfaces from claiming
 * foreground attention for the same installation at the same time. A future
 * multi-window coordinator can replace the registry without changing the
 * state contract.
 */
export class AttentionStateMachine {
  private static readonly owners = new Map<string, OwnerRecord>();
  /** Surfaces waiting (foreground-eligible but not owning) for promotion. */
  private static readonly waiting = new Map<string, AttentionStateMachine[]>();

  private readonly installationId: string;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly listeners = new Set<(change: AttentionStateChange) => void>();
  private state: AttentionState = 'unknown';
  private focused = false;
  private surfaceVisible = false;
  private locked = false;
  private connected = true;
  private ownsAttention = false;
  private disposed = false;

  constructor(options: AttentionStateMachineOptions) {
    if (!options.installationId.trim()) throw new Error('Attention installationId is required');
    if (!options.ownerId.trim()) throw new Error('Attention ownerId is required');
    this.installationId = options.installationId;
    this.ownerId = options.ownerId;
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 60_000;
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

  /**
   * Claim installation attention ownership BEFORE the Ateva surface is
   * visible, so the focus→visible transition keeps a stable owner. Returns
   * whether this surface now holds ownership (false when the window is not
   * focused or another surface already owns attention).
   */
  reserveOwner(): boolean {
    if (this.locked || !this.connected || !this.focused) return false;
    if (!this.claimLease()) return false;
    this.ownsAttention = true;
    this.removeFromWaiting();
    return true;
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

  /** Update whether a Ateva-owned surface is currently visible. */
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
    this.removeFromWaiting();
    this.focused = false;
    this.surfaceVisible = false;
    this.locked = false;
    this.connected = true;
    this.transition('unknown', 'reset');
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
    this.listeners.clear();
  }

  private recompute(reason: AttentionStateChangeReason): void {
    if (this.disposed) return;
    const next = this.resolveState();
    if (next === 'foreground_visible') {
      this.acquireOwner();
      if (!this.ownsAttention) {
        // Another surface owns attention: stay foreground-eligible but not
        // owning, and register for promotion when that owner releases.
        this.enqueueWaiting();
        this.transition('foreground_not_visible', reason);
        return;
      }
    } else if (this.ownsAttention) {
      this.releaseOwner();
    } else {
      this.removeFromWaiting();
    }
    this.transition(next, reason);
  }

  private resolveState(): AttentionState {
    if (this.locked) return 'device_locked';
    if (!this.connected) return 'disconnected';
    if (!this.focused) return 'background';
    return this.surfaceVisible ? 'foreground_visible' : 'foreground_not_visible';
  }

  /**
   * Claim (or refresh) the installation lease. A stale lease from a crashed
   * surface is reclaimable, so a dead owner can never stall promotion
   * forever. Returns whether this machine holds the lease afterwards.
   */
  private claimLease(): boolean {
    const current = AttentionStateMachine.owners.get(this.installationId);
    if (current && current.ownerId !== this.ownerId && current.leasedUntil >= this.now()) {
      return false;
    }
    AttentionStateMachine.owners.set(this.installationId, {
      ownerId: this.ownerId,
      leasedUntil: this.now() + this.leaseMs,
    });
    return true;
  }

  private acquireOwner(): void {
    this.ownsAttention = this.claimLease();
  }

  private releaseOwner(): void {
    const current = AttentionStateMachine.owners.get(this.installationId);
    if (current?.ownerId === this.ownerId) {
      AttentionStateMachine.owners.delete(this.installationId);
      this.promoteNext();
    }
    this.ownsAttention = false;
  }

  private enqueueWaiting(): void {
    const list = AttentionStateMachine.waiting.get(this.installationId) ?? [];
    if (!list.includes(this)) list.push(this);
    AttentionStateMachine.waiting.set(this.installationId, list);
  }

  private removeFromWaiting(): void {
    const list = AttentionStateMachine.waiting.get(this.installationId);
    if (!list) return;
    const next = list.filter((machine) => machine !== this);
    if (next.length) AttentionStateMachine.waiting.set(this.installationId, next);
    else AttentionStateMachine.waiting.delete(this.installationId);
  }

  /**
   * After the current owner releases, hand attention to the first waiting
   * surface that is still foreground-eligible. The promoted surface recomputes
   * (acquiring ownership) so no separate observation event is required.
   * Disposed machines and stale leases can never block the queue.
   */
  private promoteNext(): void {
    const list = AttentionStateMachine.waiting.get(this.installationId) ?? [];
    for (const candidate of list) {
      if (candidate.disposed) continue;
      if (
        !candidate.ownsAttention &&
        candidate.focused &&
        candidate.surfaceVisible &&
        !candidate.locked &&
        candidate.connected
      ) {
        candidate.recompute('promotion');
        return;
      }
    }
    AttentionStateMachine.waiting.delete(this.installationId);
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
