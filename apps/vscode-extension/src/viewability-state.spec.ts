import { describe, expect, it } from 'vitest';

import { isViewableObservation, resolveViewabilityState } from './viewability-state';

describe('viewability state', () => {
  const visible = {
    focused: true,
    surfaceVisible: true,
    deviceLocked: false,
    connected: true,
  };

  it('requires focus and a visible surface', () => {
    expect(resolveViewabilityState(visible)).toBe('foreground_visible');
    expect(isViewableObservation(visible)).toBe(true);
    expect(isViewableObservation({ ...visible, surfaceVisible: false })).toBe(false);
    expect(isViewableObservation({ ...visible, focused: false })).toBe(false);
  });

  it('prioritizes lock and disconnect over foreground observations', () => {
    expect(resolveViewabilityState({ ...visible, deviceLocked: true })).toBe('device_locked');
    expect(resolveViewabilityState({ ...visible, connected: false })).toBe('disconnected');
    expect(isViewableObservation({ ...visible, deviceLocked: true, connected: false })).toBe(false);
  });

  it('does not infer viewability from an active agent or focus alone', () => {
    expect(resolveViewabilityState({ ...visible, focused: true, surfaceVisible: false })).toBe(
      'foreground_not_visible',
    );
    expect(resolveViewabilityState({ ...visible, focused: false, surfaceVisible: true })).toBe(
      'background',
    );
  });

  it('fails closed for minimized, covered, unloaded, and partially visible surfaces', () => {
    for (const observation of [
      { ...visible, windowMinimized: true },
      { ...visible, surfaceCovered: true },
      { ...visible, adLoaded: false },
      { ...visible, adVisible: false },
      { ...visible, visibleSurfacePercent: 49 },
      { ...visible, visibleSurfacePercent: Number.NaN },
    ]) {
      expect(isViewableObservation(observation)).toBe(false);
    }
    expect(isViewableObservation({ ...visible, visibleSurfacePercent: 50 })).toBe(true);
  });

  it('treats application backgrounding as background, not an unknown visible state', () => {
    expect(resolveViewabilityState({ ...visible, appBackgrounded: true })).toBe('background');
  });
});
