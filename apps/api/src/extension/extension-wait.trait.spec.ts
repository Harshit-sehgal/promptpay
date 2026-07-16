import { describe, expect, it, vi } from 'vitest';

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
    };
    const { prisma, trait } = makeTrait();
    prisma.waitStateEvent.findFirst.mockResolvedValue(start);
    prisma.waitStateEvent.update.mockResolvedValue({ ...start, isFalsePositive: true });

    const result = await trait.flagFalsePositive('u1', 'ws-id-1');

    expect(result.isFalsePositive).toBe(true);
    expect(prisma.waitStateEvent.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: { isFalsePositive: true },
    });
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
