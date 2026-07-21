import { DETECTOR_VERSION, DetectorEvidence, signEvidence } from '@waitlayer/shared';

export const TEST_DEVICE_SECRET = 'test-device-secret-do-not-use-in-production';

export function makeTestEvidence(
  items: Array<Partial<DetectorEvidence> & Pick<DetectorEvidence, 'type' | 'adapterId'>>,
  options: { waitStateId?: string; sessionId?: string } = {},
): DetectorEvidence[] {
  const waitStateId = options.waitStateId ?? 'ws-test';
  const sessionId = options.sessionId ?? 'session-test';
  const now = Date.now();

  return items.map((item, index) => {
    const base: Omit<DetectorEvidence, 'signature'> = {
      type: item.type,
      sourceType: item.sourceType ?? 'observed',
      adapterId: item.adapterId,
      detectorVersion: item.detectorVersion ?? DETECTOR_VERSION,
      timestamp: item.timestamp ?? now + index,
      waitStateId: item.waitStateId ?? waitStateId,
      sessionId: item.sessionId ?? sessionId,
      correlationId: item.correlationId ?? `corr-${index}`,
    };
    return {
      ...base,
      signature: signEvidence(base, TEST_DEVICE_SECRET),
    };
  });
}
