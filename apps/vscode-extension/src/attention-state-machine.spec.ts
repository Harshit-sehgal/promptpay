import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { AttentionStateMachine } from './attention-state-machine';

function machine() {
  let now = 1_000;
  const state = new AttentionStateMachine({
    installationId: `installation-${randomUUID()}`,
    ownerId: `owner-${randomUUID()}`,
    now: () => now,
  });
  return {
    state,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('AttentionStateMachine (WL-051)', () => {
  it('requires both focus and a visible Ateva surface for foreground attention', () => {
    const { state } = machine();

    expect(state.getState()).toBe('unknown');
    state.setWindowFocused(true);
    expect(state.getState()).toBe('foreground_not_visible');
    expect(state.isOwner()).toBe(false);

    state.setSurfaceVisible(true);
    expect(state.getState()).toBe('foreground_visible');
    expect(state.isOwner()).toBe(true);
  });

  it('allows only one foreground owner per installation and releases it on background', () => {
    const installationId = `installation-${randomUUID()}`;
    const first = new AttentionStateMachine({
      installationId,
      ownerId: 'window-a',
    });
    const second = new AttentionStateMachine({
      installationId,
      ownerId: 'window-b',
    });

    first.setWindowFocused(true);
    first.setSurfaceVisible(true);
    second.setWindowFocused(true);
    second.setSurfaceVisible(true);

    expect(first.isOwner()).toBe(true);
    expect(first.getState()).toBe('foreground_visible');
    expect(second.isOwner()).toBe(false);
    expect(second.getState()).toBe('foreground_not_visible');

    first.setWindowFocused(false);
    second.setSurfaceVisible(true);
    expect(first.getState()).toBe('background');
    expect(second.isOwner()).toBe(true);
    expect(second.getState()).toBe('foreground_visible');

    first.dispose();
    second.dispose();
  });

  it('prioritizes lock and disconnect states over focus observations', () => {
    const { state } = machine();
    state.setWindowFocused(true);
    state.setSurfaceVisible(true);
    expect(state.getState()).toBe('foreground_visible');

    state.setDeviceLocked(true);
    expect(state.getState()).toBe('device_locked');
    expect(state.isOwner()).toBe(false);

    state.setDeviceLocked(false);
    state.setBridgeConnected(false);
    expect(state.getState()).toBe('disconnected');

    state.setBridgeConnected(true);
    expect(state.getState()).toBe('foreground_visible');
    expect(state.isOwner()).toBe(true);
  });

  it('emits timestamped changes and isolates listener failures', () => {
    const { state, advance } = machine();
    const changes: string[] = [];
    state.onChange(() => {
      throw new Error('observer failure');
    });
    state.onChange((change) => {
      changes.push(`${change.previous}->${change.current}:${change.occurredAt}`);
    });

    advance(25);
    state.setWindowFocused(true);
    advance(25);
    state.setSurfaceVisible(true);

    expect(changes).toEqual([
      'unknown->foreground_not_visible:1025',
      'foreground_not_visible->foreground_visible:1050',
    ]);
  });

  it('reset releases ownership and restores an unobserved state', () => {
    const { state } = machine();
    const listener = vi.fn();
    state.onChange(listener);
    state.setWindowFocused(true);
    state.setSurfaceVisible(true);

    state.reset();

    expect(state.getState()).toBe('unknown');
    expect(state.isOwner()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ current: 'unknown', reason: 'reset' }),
    );
  });

  it('reserveOwner claims attention before the surface becomes visible', () => {
    const { state } = machine();
    state.setWindowFocused(true);
    expect(state.getState()).toBe('foreground_not_visible');
    expect(state.isOwner()).toBe(false);

    expect(state.reserveOwner()).toBe(true);
    expect(state.isOwner()).toBe(true);

    state.setSurfaceVisible(true);
    expect(state.getState()).toBe('foreground_visible');
    expect(state.isOwner()).toBe(true);
    state.dispose();
  });

  it('reserveOwner refuses while another surface owns attention', () => {
    const installationId = `installation-${randomUUID()}`;
    const first = new AttentionStateMachine({ installationId, ownerId: 'window-a' });
    const second = new AttentionStateMachine({ installationId, ownerId: 'window-b' });
    first.setWindowFocused(true);
    first.reserveOwner();
    expect(first.isOwner()).toBe(true);

    second.setWindowFocused(true);
    expect(second.reserveOwner()).toBe(false);
    expect(second.isOwner()).toBe(false);
    first.dispose();
    second.dispose();
  });

  it('promotes the next eligible surface when the owner releases', () => {
    const installationId = `installation-${randomUUID()}`;
    const first = new AttentionStateMachine({ installationId, ownerId: 'window-a' });
    const second = new AttentionStateMachine({ installationId, ownerId: 'window-b' });
    first.setWindowFocused(true);
    first.setSurfaceVisible(true);
    expect(first.isOwner()).toBe(true);

    second.setWindowFocused(true);
    second.setSurfaceVisible(true);
    expect(second.isOwner()).toBe(false);
    expect(second.getState()).toBe('foreground_not_visible');

    // No observation on the second surface is required — releasing the owner
    // promotes the waiting surface automatically.
    first.reset();
    expect(second.isOwner()).toBe(true);
    expect(second.getState()).toBe('foreground_visible');
    first.dispose();
    second.dispose();
  });

  it('reclaims a stale lease from a crashed owner so the queue never stalls', () => {
    const installationId = `installation-${randomUUID()}`;
    let now = 1_000;
    const crashed = new AttentionStateMachine({
      installationId,
      ownerId: 'window-a',
      now: () => now,
      leaseMs: 60_000,
    });
    crashed.setWindowFocused(true);
    crashed.setSurfaceVisible(true);
    expect(crashed.isOwner()).toBe(true);

    // The crashed window never releases; its lease simply expires.
    now += 61_000;
    const next = new AttentionStateMachine({
      installationId,
      ownerId: 'window-b',
      now: () => now,
      leaseMs: 60_000,
    });
    next.setWindowFocused(true);
    next.setSurfaceVisible(true);
    expect(next.isOwner()).toBe(true);
    expect(next.getState()).toBe('foreground_visible');
    crashed.dispose();
    next.dispose();
  });

  it('treats an unexpired lease as blocking until it runs out', () => {
    const installationId = `installation-${randomUUID()}`;
    let now = 1_000;
    const first = new AttentionStateMachine({
      installationId,
      ownerId: 'window-a',
      now: () => now,
      leaseMs: 30_000,
    });
    first.setWindowFocused(true);
    first.setSurfaceVisible(true);
    expect(first.isOwner()).toBe(true);

    const second = new AttentionStateMachine({
      installationId,
      ownerId: 'window-b',
      now: () => now,
      leaseMs: 30_000,
    });
    second.setWindowFocused(true);
    second.setSurfaceVisible(true);
    expect(second.isOwner()).toBe(false);
    expect(second.reserveOwner()).toBe(false);
    expect(second.getState()).toBe('foreground_not_visible');

    // Lease expiry alone (no release from the crashed owner) unblocks the
    // waiter on its next observation recompute.
    now += 31_000;
    second.setSurfaceVisible(true);
    expect(second.isOwner()).toBe(true);
    expect(second.getState()).toBe('foreground_visible');
    first.dispose();
    second.dispose();
  });

  it('refreshes the lease on every observation while owning attention', () => {
    const installationId = `installation-${randomUUID()}`;
    let now = 1_000;
    const owner = new AttentionStateMachine({
      installationId,
      ownerId: 'window-a',
      now: () => now,
      leaseMs: 40_000,
    });
    owner.setWindowFocused(true);
    owner.setSurfaceVisible(true);
    expect(owner.isOwner()).toBe(true);

    const contender = new AttentionStateMachine({
      installationId,
      ownerId: 'window-b',
      now: () => now,
      leaseMs: 40_000,
    });
    // Periodic observations keep the lease alive past the 60s mark.
    for (let t = 0; t < 4; t += 1) {
      now += 25_000;
      owner.setSurfaceVisible(true);
      expect(owner.isOwner()).toBe(true);
      contender.setWindowFocused(true);
      contender.setSurfaceVisible(true);
      expect(contender.isOwner()).toBe(false);
    }
    owner.dispose();
    contender.dispose();
  });

  it('promotion skips disposed waiters and never promotes a dead machine', () => {
    const installationId = `installation-${randomUUID()}`;
    const now = 1_000;
    const first = new AttentionStateMachine({
      installationId,
      ownerId: 'window-a',
      now: () => now,
      leaseMs: 60_000,
    });
    first.setWindowFocused(true);
    first.setSurfaceVisible(true);
    const disposedWaiter = new AttentionStateMachine({
      installationId,
      ownerId: 'window-b',
      now: () => now,
      leaseMs: 60_000,
    });
    disposedWaiter.setWindowFocused(true);
    disposedWaiter.setSurfaceVisible(true);
    expect(disposedWaiter.isOwner()).toBe(false);
    disposedWaiter.dispose();

    const third = new AttentionStateMachine({
      installationId,
      ownerId: 'window-c',
      now: () => now,
      leaseMs: 60_000,
    });
    third.setWindowFocused(true);
    third.setSurfaceVisible(true);
    expect(third.isOwner()).toBe(false);

    first.reset();
    // The disposed waiter is skipped; the remaining eligible waiter wins.
    expect(third.isOwner()).toBe(true);
    expect(third.getState()).toBe('foreground_visible');
    first.dispose();
    third.dispose();
  });
});
