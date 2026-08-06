import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AgentService } from './agent.service';
import { AgentAnalyticsQueryDto } from './dto';

function makeService() {
  const prisma = {
    agentSession: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    agentWorkUnit: { groupBy: vi.fn() },
    adOpportunity: { groupBy: vi.fn() },
  };
  const service = new AgentService(
    prisma as never,
    { get: vi.fn((key: string, fallback: string) => fallback) } as never,
  );
  return { service, prisma };
}

function query(overrides: Partial<AgentAnalyticsQueryDto> = {}): AgentAnalyticsQueryDto {
  return {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-08T00:00:00.000Z',
    page: 1,
    limit: 25,
    ...overrides,
  };
}

describe('AgentService.getAnalytics (WL-034)', () => {
  it('returns bounded privacy-safe session and work-unit aggregates', async () => {
    const { service, prisma } = makeService();
    prisma.agentSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        provider: 'claude_code',
        integrationMode: 'native_hook',
        status: 'ended',
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        endedAt: new Date('2026-08-02T00:05:00.000Z'),
        _count: { events: 4, workUnits: 2 },
      },
    ]);
    prisma.agentSession.count.mockResolvedValue(1);
    prisma.agentSession.groupBy
      .mockResolvedValueOnce([{ provider: 'claude_code', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ status: 'ended', _count: { _all: 1 } }]);
    prisma.agentWorkUnit.groupBy.mockResolvedValue([
      { kind: 'turn', status: 'completed', _count: { _all: 1 } },
    ]);
    prisma.adOpportunity.groupBy.mockResolvedValue([
      { placementType: 'completion_return', state: 'claimed', _count: { _all: 1 } },
    ]);

    const result = await service.getAnalytics('user-a', query());

    expect(prisma.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          startedAt: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lt: new Date('2026-08-08T00:00:00.000Z'),
          },
        },
        take: 25,
      }),
    );
    expect(prisma.agentWorkUnit.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { session: expect.any(Object) } }),
    );
    expect(result).toMatchObject({
      mode: 'agent_telemetry',
      financialSideEffects: false,
      environmentId: 'local',
      total: 1,
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          durationMs: 300000,
          eventCount: 4,
          workUnitCount: 2,
        }),
      ],
      aggregates: {
        byProvider: [{ provider: 'claude_code', sessions: 1 }],
        byStatus: [{ status: 'ended', sessions: 1 }],
        workUnits: [{ kind: 'turn', status: 'completed', count: 1 }],
        opportunities: [{ placementType: 'completion_return', state: 'claimed', count: 1 }],
        opportunityMetrics: { total: 1, claimed: 1, expired: 0, claimRate: 1 },
      },
    });
    expect(JSON.stringify(result)).not.toContain('metadata');
    expect(JSON.stringify(result)).not.toContain('providerSessionHash');
    expect(JSON.stringify(result)).not.toContain('ledger');
  });

  it('rejects invalid and overlong ranges before querying storage', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.getAnalytics(
        'user-a',
        query({ from: '2026-07-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getAnalytics(
        'user-a',
        query({ from: '2026-08-08T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentSession.findMany).not.toHaveBeenCalled();
  });

  it('uses defaults and preserves the authenticated user ownership filter', async () => {
    const { service, prisma } = makeService();
    prisma.agentSession.findMany.mockResolvedValue([]);
    prisma.agentSession.count.mockResolvedValue(0);
    prisma.agentSession.groupBy.mockResolvedValue([]);
    prisma.agentWorkUnit.groupBy.mockResolvedValue([]);
    prisma.adOpportunity.groupBy.mockResolvedValue([]);

    const result = await service.getAnalytics('user-b', {} as AgentAnalyticsQueryDto);

    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
    expect(result.aggregates.opportunityMetrics).toEqual({
      total: 0,
      claimed: 0,
      expired: 0,
      claimRate: 0,
    });
    expect(prisma.agentSession.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-b' }) }),
    );
  });
});
