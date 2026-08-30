import type { AttentionState } from './attention-state-machine';

export type ViewabilityObservation = {
  focused: boolean;
  surfaceVisible: boolean;
  deviceLocked: boolean;
  connected: boolean;
};

/** Resolve viewability from explicit platform observations only. */
export function resolveViewabilityState(observation: ViewabilityObservation): AttentionState {
  if (observation.deviceLocked) return 'device_locked';
  if (!observation.connected) return 'disconnected';
  if (!observation.focused) return 'background';
  return observation.surfaceVisible ? 'foreground_visible' : 'foreground_not_visible';
}

/** A qualifying visible surface requires both foreground focus and visibility. */
export function isViewableObservation(observation: ViewabilityObservation): boolean {
  return resolveViewabilityState(observation) === 'foreground_visible';
}
