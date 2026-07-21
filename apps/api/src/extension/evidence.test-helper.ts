import {
  DETECTOR_VERSION,
  DetectorEvidence,
  EvidenceSignalType,
  signEvidence,
} from '@waitlayer/shared';

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

/**
 * Create signed billable evidence items for a specific wait state start,
 * signed with the provided device secret. Produces two distinct observed
 * primary evidence types (ai_generation + command_execution) so the
 * server-side classifyWaitState returns paymentEligible: true.
 */
export function createSignedBillableEvidence(
  deviceSecret: string,
  waitStateId: string,
  sessionId: string,
): DetectorEvidence[] {
  const now = Date.now();
  const items: Array<Omit<DetectorEvidence, 'signature'>> = [
    {
      type: 'ai_generation' as EvidenceSignalType,
      sourceType: 'observed',
      adapterId: 'test.adapter.ai',
      detectorVersion: DETECTOR_VERSION,
      timestamp: now - 100,
      waitStateId,
      sessionId,
      correlationId: waitStateId,
    },
    {
      type: 'command_execution' as EvidenceSignalType,
      sourceType: 'observed',
      adapterId: 'test.adapter.cmd',
      detectorVersion: DETECTOR_VERSION,
      timestamp: now,
      waitStateId,
      sessionId,
      correlationId: waitStateId,
    },
  ];
  return items.map((item) => ({
    ...item,
    signature: signEvidence(item, deviceSecret),
  }));
}
