import type { AttentionState } from './attention-state-machine';

export type ViewabilityObservation = {
  focused: boolean;
  surfaceVisible: boolean;
  deviceLocked: boolean;
  connected: boolean;
  /** Optional platform observations; absence remains backwards-compatible. */
  appBackgrounded?: boolean;
  windowMinimized?: boolean;
  surfaceCovered?: boolean;
  adLoaded?: boolean;
  adVisible?: boolean;
  visibleSurfacePercent?: number;
};

/** Resolve viewability from explicit platform observations only. */
export function resolveViewabilityState(observation: ViewabilityObservation): AttentionState {
  if (observation.deviceLocked) return 'device_locked';
  if (!observation.connected) return 'disconnected';
  if (observation.appBackgrounded || observation.windowMinimized || !observation.focused) {
    return 'background';
  }
  if (
    !observation.surfaceVisible ||
    observation.surfaceCovered ||
    observation.adLoaded === false ||
    observation.adVisible === false ||
    !isSufficientlyVisible(observation.visibleSurfacePercent)
  ) {
    return 'foreground_not_visible';
  }
  return 'foreground_visible';
}

/** A qualifying visible surface requires both foreground focus and visibility. */
export function isViewableObservation(observation: ViewabilityObservation): boolean {
  return resolveViewabilityState(observation) === 'foreground_visible';
}

function isSufficientlyVisible(percent: number | undefined): boolean {
  if (percent === undefined) return true;
  return Number.isFinite(percent) && percent >= 50;
}
