import { describe, expect, it, vi } from 'vitest';

import { DETECTOR_VERSION, signEvidence } from '@waitlayer/shared';

import { AlertsService } from '../observability/alerts.service';
import { MetricsService } from '../observability/metrics.service';
import {
  computeWaitConfidence,
  ExtensionWaitTrait,
  MINIMUM_WAIT_CONFIDENCE,
  SIGNAL_WEIGHTS,
} from './extension-wait.trait';

describe('computeWaitConfidence', () => {
  it('returns zero confidence when no signals are provided', () => {
    const result = computeWaitConfidence([]);
    expect(result.confidence).toBe(0);
    expect(result.reason).toBe('no_signals');
  });

  it('scores ai_generation as the highest-confidence signal', () => {
    const result = computeWaitConfidence([
      { type: 'inactivity' },
      { type: 'ai_generation', details: 'copilot streaming response' },
    ]);
    expect(result.confidence).toBe(SIGNAL_WEIGHTS.ai_generation);
    expect(result.reason).toBe('ai_generation');
  });

  it('scores active_task above lifecycle_event and inactivity', () => {
    const result = computeWaitConfidence([
      { type: 'lifecycle_event' },
      { type: 'active_task', details: 'terminal build running' },
      { type: 'inactivity' },
    ]);
    expect(result.confidence).toBe(SIGNAL_WEIGHTS.active_task);
    expect(result.reason).toBe('active_task');
  });

  it('scores command_execution above inactivity', () => {
    const result = computeWaitConfidence([{ type: 'command_execution' }, { type: 'inactivity' }]);
    expect(result.confidence).toBe(SIGNAL_WEIGHTS.command_execution);
    expect(result.reason).toBe('command_execution');
  });

  it('scores inactivity as very low confidence', () => {
    const result = computeWaitConfidence([{ type: 'inactivity' }]);
    expect(result.confidence).toBe(SIGNAL_WEIGHTS.inactivity);
    expect(result.reason).toBe('inactivity');
    expect(result.confidence).toBeLessThan(MINIMUM_WAIT_CONFIDENCE);
  });
});

describe('ExtensionWaitTrait.flagFalsePositive', () => {
  function makeTrait(overrides: Record<string, unknown> = {}) {
    const prisma = {
      waitStateEvent: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      ...overrides,
    };
    const trait = new ExtensionWaitTrait();
    (trait as unknown as { prisma: typeof prisma }).prisma = prisma as never;
    return { prisma, trait };
  }

  it('flags the latest start event as a false positive', async () => {
    const start = {
      id: 'ws-1',
      userId: 'u1',
      waitStateId: 'ws-id-1',
      eventType: 'wait_state_start',
      isFalsePositive: false,
    };
    const { prisma, trait } = makeTrait();
    prisma.waitStateEvent.findFirst.mockResolvedValue(start);
    prisma.waitStateEvent.update.mockResolvedValue({ ...start, isFalsePositive: true });

    const result = await trait.flagFalsePositive('u1', 'ws-id-1');

    expect(result.isFalsePositive).toBe(true);
    expect(prisma.waitStateEvent.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: {
        isFalsePositive: true,
        falsePositiveReason: null,
        falsePositiveNote: null,
        falsePositiveReportedAt: expect.any(Date),
      },
    });
  });

  it('persists the normalized reason, note and report timestamp (P1 #16)', async () => {
    const start = {
      id: 'ws-1',
      userId: 'u1',
      waitStateId: 'ws-id-1',
      eventType: 'wait_state_start',
      isFalsePositive: false,
    };
    const { prisma, trait } = makeTrait();
    prisma.waitStateEvent.findFirst.mockResolvedValue(start);
    prisma.waitStateEvent.update.mockImplementation((_args: { data: object }) => ({
      ...start,
      ..._args.data,
    }));

    const result = await trait.flagFalsePositive('u1', 'ws-id-1', {
      reason: 'no_ai_generation',
      note: 'was reading docs',
    });

    expect(prisma.waitStateEvent.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: {
        isFalsePositive: true,
        falsePositiveReason: 'no_ai_generation',
        falsePositiveNote: 'was reading docs',
        falsePositiveReportedAt: expect.any(Date),
      },
    });
    expect(result.falsePositiveReason).toBe('no_ai_generation');
    expect(result.falsePositiveReportedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — a repeated report never overwrites the first feedback (P1 #16)', async () => {
    const alreadyFlagged = {
      id: 'ws-1',
      userId: 'u1',
      waitStateId: 'ws-id-1',
      eventType: 'wait_state_start',
      isFalsePositive: true,
      falsePositiveReason: 'actively_working',
      falsePositiveNote: null,
      falsePositiveReportedAt: new Date('2026-07-20T00:00:00Z'),
    };
    const { prisma, trait } = makeTrait();
    prisma.waitStateEvent.findFirst.mockResolvedValue(alreadyFlagged);

    const result = await trait.flagFalsePositive('u1', 'ws-id-1', {
      reason: 'other',
      note: 'changed my mind',
    });

    expect(prisma.waitStateEvent.update).not.toHaveBeenCalled();
    expect(result.falsePositiveReason).toBe('actively_working');
  });

  it('raises a deduplicated wait_false_positive_spike alert on a burst of reports (P1.25)', async () => {
    const start = {
      id: 'ws-1',
      userId: 'u1',
      waitStateId: 'ws-id-1',
      eventType: 'wait_state_start',
    };
    const { prisma, trait } = makeTrait();
    const metrics = new MetricsService();
    const alerts = new AlertsService(metrics);
    const sendSpy = vi.spyOn(alerts, 'sendAlert');
    (trait as unknown as { alerts: AlertsService }).alerts = alerts;

    prisma.waitStateEvent.findFirst.mockResolvedValue(start);
    prisma.waitStateEvent.update.mockResolvedValue({ ...start, isFalsePositive: true });

    // 5 reports (threshold) + 1 => a single deduplicated spike alert.
    for (let i = 0; i < 6; i++) {
      await trait.flagFalsePositive('u1', `ws-id-${i}`);
    }

    expect(sendSpy).toHaveBeenCalledWith(
      'wait_false_positive_spike',
      'global',
      expect.objectContaining({ windowCount: expect.any(Number) }),
    );
    // Cooldown dedupe: only the first fire within the window is forwarded.
    expect(metrics.getCounter('alert{event=wait_false_positive_spike}')).toBe(1);
  });

  it('throws NotFoundException when no matching wait state exists', async () => {
    const { prisma, trait } = makeTrait();
    prisma.waitStateEvent.findFirst.mockResolvedValue(null);

    await expect(trait.flagFalsePositive('u1', 'ws-id-1')).rejects.toThrow('Wait state not found');
  });

  it('throws ForbiddenException when the wait state belongs to another user', async () => {
    const start = {
      id: 'ws-1',
      userId: 'u2',
      waitStateId: 'ws-id-1',
      eventType: 'wait_state_start',
    };
    const { prisma, trait } = makeTrait();
    prisma.waitStateEvent.findFirst.mockResolvedValue(start);

    await expect(trait.flagFalsePositive('u1', 'ws-id-1')).rejects.toThrow(
      'You do not own this wait state',
    );
  });
});

describe('wait-detection evaluation fixtures', () => {
  const fixtures: {
    name: string;
    signals: { type: keyof typeof SIGNAL_WEIGHTS; details?: string }[];
    expectedConfidence: number;
    expectedReason: string;
    isWait: boolean;
  }[] = [
    {
      name: 'AI generation is a strong wait signal',
      signals: [{ type: 'ai_generation' }],
      expectedConfidence: SIGNAL_WEIGHTS.ai_generation,
      expectedReason: 'ai_generation',
      isWait: true,
    },
    {
      name: 'Active task is a wait signal',
      signals: [{ type: 'active_task' }],
      expectedConfidence: SIGNAL_WEIGHTS.active_task,
      expectedReason: 'active_task',
      isWait: true,
    },
    {
      name: 'Command execution is a wait signal',
      signals: [{ type: 'command_execution' }],
      expectedConfidence: SIGNAL_WEIGHTS.command_execution,
      expectedReason: 'command_execution',
      isWait: true,
    },
    {
      name: 'Lifecycle event alone is below billing threshold (ambiguous)',
      signals: [{ type: 'lifecycle_event' }],
      expectedConfidence: SIGNAL_WEIGHTS.lifecycle_event,
      expectedReason: 'lifecycle_event',
      isWait: false,
    },
    {
      name: 'Inactivity alone is not a wait signal',
      signals: [{ type: 'inactivity' }],
      expectedConfidence: SIGNAL_WEIGHTS.inactivity,
      expectedReason: 'inactivity',
      isWait: false,
    },
    {
      name: 'Mixed signals dominated by AI generation',
      signals: [{ type: 'inactivity' }, { type: 'lifecycle_event' }, { type: 'ai_generation' }],
      expectedConfidence: SIGNAL_WEIGHTS.ai_generation,
      expectedReason: 'ai_generation',
      isWait: true,
    },
    {
      name: 'No signals means no wait',
      signals: [],
      expectedConfidence: 0,
      expectedReason: 'no_signals',
      isWait: false,
    },
  ];

  it.each(fixtures)('$name', ({ signals, expectedConfidence, expectedReason, isWait }) => {
    const result = computeWaitConfidence(signals);
    expect(result.confidence).toBe(expectedConfidence);
    expect(result.reason).toBe(expectedReason);
    expect(result.confidence >= MINIMUM_WAIT_CONFIDENCE).toBe(isWait);
  });
});

describe('ExtensionWaitTrait.recordWaitStateStart — detector version kill-switch (P1.17)', () => {
  function makeTrait(overrides: Record<string, unknown> = {}) {
    const prisma = {
      device: { findUnique: vi.fn() },
      waitStateEvent: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };
    const runtimeConfig = {
      isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
      ...(overrides.runtimeConfig as Record<string, unknown>),
    };
    const { runtimeConfig: _ignored, ...rest } = overrides;
    const trait = new ExtensionWaitTrait();
    Object.assign(trait as unknown as Record<string, unknown>, {
      prisma,
      runtimeConfig,
      enforcePrivacyOn: vi.fn(),
      verifyDeviceSignature: vi.fn().mockResolvedValue(true),
      ...rest,
    });
    return { prisma, runtimeConfig, trait };
  }

  const baseDto = {
    deviceId: 'd1',
    sessionId: 's1',
    toolType: 'cursor',
    waitStateId: 'ws1',
    idempotencyKey: 'idk1',
    detectorVersion: '1.0.0',
    signature: 'sig',
  };

  it('throws ForbiddenException and does not record when the detector version is disabled', async () => {
    const { prisma, runtimeConfig, trait } = makeTrait({
      runtimeConfig: { isDetectorVersionEnabled: vi.fn().mockResolvedValue(false) },
    });
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prisma.waitStateEvent.findFirst.mockResolvedValue(null);
    prisma.waitStateEvent.findUnique.mockResolvedValue(null);

    await expect(trait.recordWaitStateStart('u1', baseDto)).rejects.toThrow(
      /Detector version .* is currently disabled/,
    );
    expect(prisma.waitStateEvent.create).not.toHaveBeenCalled();
    expect(runtimeConfig.isDetectorVersionEnabled).toHaveBeenCalledWith('1.0.0');
  });

  it('records the wait state normally when the detector version is enabled', async () => {
    const { prisma, runtimeConfig, trait } = makeTrait();
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prisma.waitStateEvent.findFirst.mockResolvedValue(null);
    prisma.waitStateEvent.findUnique.mockResolvedValue(null);
    prisma.waitStateEvent.create.mockResolvedValue({
      id: 'evt-1',
      eventType: 'wait_state_start',
      detectorVersion: '1.0.0',
    });

    const result = await trait.recordWaitStateStart('u1', baseDto);
    expect(runtimeConfig.isDetectorVersionEnabled).toHaveBeenCalledWith('1.0.0');
    expect(prisma.waitStateEvent.create).toHaveBeenCalledTimes(1);
    expect(result.detectorVersion).toBe('1.0.0');
  });
});

describe('ExtensionWaitTrait.recordWaitStateStart — evidence verification (P0)', () => {
  function makeTrait(overrides: Record<string, unknown> = {}) {
    const prisma = {
      device: { findUnique: vi.fn() },
      waitStateEvent: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };
    const runtimeConfig = {
      isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
      ...(overrides.runtimeConfig as Record<string, unknown>),
    };
    const { runtimeConfig: _ignored, ...rest } = overrides;
    const trait = new ExtensionWaitTrait();
    Object.assign(trait as unknown as Record<string, unknown>, {
      prisma,
      runtimeConfig,
      enforcePrivacyOn: vi.fn(),
      verifyDeviceSignature: vi.fn().mockResolvedValue(true),
      ...rest,
    });
    return { prisma, runtimeConfig, trait };
  }

  const secret = 'device-secret-42';
  const baseDto = {
    deviceId: 'd1',
    sessionId: 's1',
    toolType: 'cursor',
    waitStateId: 'ws1',
    idempotencyKey: 'idk1',
    detectorVersion: '1.0.0',
    signature: 'sig',
  };

  function signedEvidence(type: 'ai_generation' | 'command_execution') {
    return {
      type,
      sourceType: 'observed' as const,
      adapterId: `test.${type}`,
      detectorVersion: DETECTOR_VERSION,
      timestamp: Date.now(),
      waitStateId: baseDto.waitStateId,
      sessionId: baseDto.sessionId,
      correlationId: 'corr-1',
      signature: '',
    };
  }

  it('rejects evidence with an invalid signature', async () => {
    const { prisma, trait } = makeTrait();
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', eventSecret: secret });
    prisma.waitStateEvent.findFirst.mockResolvedValue(null);
    prisma.waitStateEvent.findUnique.mockResolvedValue(null);

    const evidence = signedEvidence('ai_generation');
    evidence.signature = 'bad-sig';

    await expect(
      trait.recordWaitStateStart('u1', { ...baseDto, evidence: [evidence] }),
    ).rejects.toThrow('Invalid evidence signature');
    expect(prisma.waitStateEvent.create).not.toHaveBeenCalled();
  });

  it('rejects evidence whose waitStateId does not match the request', async () => {
    const { prisma, trait } = makeTrait();
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', eventSecret: secret });
    prisma.waitStateEvent.findFirst.mockResolvedValue(null);
    prisma.waitStateEvent.findUnique.mockResolvedValue(null);

    const item = signedEvidence('ai_generation');
    item.signature = signEvidence(item, secret);
    item.waitStateId = 'ws-other';

    await expect(
      trait.recordWaitStateStart('u1', { ...baseDto, evidence: [item] }),
    ).rejects.toThrow('Evidence does not belong to this wait state');
    expect(prisma.waitStateEvent.create).not.toHaveBeenCalled();
  });

  it('records the wait state when evidence signatures are valid', async () => {
    const { prisma, trait } = makeTrait();
    prisma.device.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', eventSecret: secret });
    prisma.waitStateEvent.findFirst.mockResolvedValue(null);
    prisma.waitStateEvent.findUnique.mockResolvedValue(null);
    prisma.waitStateEvent.create.mockResolvedValue({
      id: 'evt-1',
      eventType: 'wait_state_start',
      detectorVersion: '1.0.0',
    });

    const ai = signedEvidence('ai_generation');
    ai.signature = signEvidence(ai, secret);
    const cmd = signedEvidence('command_execution');
    cmd.signature = signEvidence(cmd, secret);

    const result = await trait.recordWaitStateStart('u1', { ...baseDto, evidence: [ai, cmd] });
    expect(result.eventType).toBe('wait_state_start');
    expect(prisma.waitStateEvent.create).toHaveBeenCalledTimes(1);
  });
});
