import { describe, expect, it, vi } from 'vitest';

import { AttentionStateMachine } from './attention-state-machine';

let nextId = 0;
function machine(overrides: Partial<ConstructorParameters<typeof AttentionStateMachine>[0]> = {}) {
  nextId += 1;
  return new AttentionStateMachine({
    installationId: `installation-attention-${nextId}`,
    ownerId: `owner-${nextId}`,
    ...overrides,
  });
}

describe('AttentionStateMachine (WL-051)', () => {
  it('separates focus from WaitLayer-surface visibility', () => {
    const attention = machine();
    const changes: string[] = [];
    attention.onChange((change) => changes.push(change.current));

    attention.setWindowFocused(true);
    expect(attention.getState()).toBe('foreground_not_visible');
    expect(attention.isOwner()).toBe(false);

    expect(attention.reserveOwner()).toBe(true);
    expect(attention.getState()).toBe('foreground_not_visible');
    attention.releaseReservation();
    expect(attention.isOwner()).toBe(false);
    expect(attention.getState()).toBe('foreground_not_visible');
    expect(attention.reserveOwner()).toBe(true);
    attention.setSurfaceVisible(true);
    expect(attention.getState()).toBe('foreground_visible');
    expect(attention.isOwner()).toBe(true);
    attention.releaseReservation();
    expect(attention.getState()).toBe('foreground_visible');
    expect(attention.isOwner()).toBe(true);
    expect(changes).toEqual(['foreground_not_visible', 'foreground_visible']);

    attention.dispose();
  });

  it('allows only one foreground owner and releases ownership on reset', () => {
    const first = machine({ installationId: 'shared-installation' });
    const second = machine({ installationId: 'shared-installation' });

    first.setWindowFocused(true);
    first.setSurfaceVisible(true);
    second.setWindowFocused(true);
    second.setSurfaceVisible(true);

    expect(first.getState()).toBe('foreground_visible');
    expect(first.isOwner()).toBe(true);
    expect(second.getState()).toBe('foreground_not_visible');
    expect(second.isOwner()).toBe(false);

    first.reset();
    // Releasing the first owner immediately recomputes peers, so the second
    // surface can claim attention without waiting for another OS event.
    expect(second.getState()).toBe('foreground_visible');
    expect(second.isOwner()).toBe(true);

    first.dispose();
    second.dispose();
  });

  it('prioritizes lock and bridge disconnect over foreground observations', () => {
    const attention = machine();
    attention.setWindowFocused(true);
    attention.setSurfaceVisible(true);

    attention.setDeviceLocked(true);
    expect(attention.getState()).toBe('device_locked');
    expect(attention.isOwner()).toBe(false);

    attention.setDeviceLocked(false);
    attention.setBridgeConnected(false);
    expect(attention.getState()).toBe('disconnected');

    attention.setBridgeConnected(true);
    expect(attention.getState()).toBe('foreground_visible');
    expect(attention.isOwner()).toBe(true);

    attention.dispose();
  });

  it('does not let a listener failure break state transitions', () => {
    const attention = machine();
    const healthy = vi.fn();
    attention.onChange(() => {
      throw new Error('observer failure');
    });
    attention.onChange(healthy);

    expect(() => attention.setWindowFocused(true)).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    attention.dispose();
  });
});
