import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cronLease from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { AgentSessionReconciliationCron } from './agent-session-reconciliation.cron';

function makeCron() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    agentSession: { findUnique: vi.fn(), updateMany: vi.fn() },
    agentLifecycleEvent: { findFirst: vi.fn() },
    agentWorkUnit: { findFirst: vi.fn() },
  };
  const prisma = {
    agentSession: { findMany: vi.fn() },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const metrics = new MetricsService();
  const cron = new AgentSessionReconciliationCron(
    prisma as unknown as PrismaService,
    metrics,
  );
  return { cron, prisma, tx, metrics };
}

describe('AgentSessionReconciliationCron (WL-033)', () => {
  beforeEach(() => {
    vi.spyOn(cronLease, 'acquireCronLease').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abandons a stale active session with no recent event or active work unit', async () => {
    const { cron, prisma, tx, metrics } = makeCron();
    prisma.agentSession.findMany.mockResolvedValue([
      { id: 'session-1', correlationId: 'correlation-1' },
    ]);
    tx.agentSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: 'active',
      endedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    tx.agentLifecycleEvent.findFirst.mockResolvedValue(null);
    tx.agentWorkUnit.findFirst.mockResolvedValue(null);
    tx.agentSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await cron.tick();

    expect(result).toMatchObject({
      acquired: true,
      scanned: 1,
      abandoned: 1,
      skippedRecent: 0,
      skippedActiveWork: 0,
      errors: 0,
    });
    expect(tx.agentSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'session-1',
        status: 'active',
        endedAt: null,
        updatedAt: { lt: expect.any(Date) },
      }),
      data: { status: 'abandoned', endedAt: expect.any(Date) },
    });
    expect(metrics.getCounter('agent_sessions_abandoned')).toBe(1);
    expect(metrics.getCounter('agent_sessions_reconciliation_abandoned')).toBe(1);
  });

  it('does not abandon a session with a recent lifecycle event', async () => {
    const { cron, prisma, tx, metrics } = makeCron();
    prisma.agentSession.findMany.mockResolvedValue([
      { id: 'session-2', correlationId: 'correlation-2' },
    ]);
    tx.agentSession.findUnique.mockResolvedValue({
      id: 'session-2',
      status: 'active',
      endedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    tx.agentLifecycleEvent.findFirst.mockResolvedValue({
      occurredAt: new Date('2020-01-01T00:00:00.000Z'),
      receivedAt: new Date(),
    });

    const result = await cron.tick();

    expect(result.skippedRecent).toBe(1);
    expect(result.abandoned).toBe(0);
    expect(tx.agentSession.updateMany).not.toHaveBeenCalled();
    expect(metrics.getCounter('agent_session_reconciliation_skipped{reason=recent_event}')).toBe(1);
  });

  it('preserves a session when a backdated offline event was received recently', async () => {
    const { cron, prisma, tx } = makeCron();
    prisma.agentSession.findMany.mockResolvedValue([
      { id: 'session-delayed', correlationId: 'correlation-delayed' },
    ]);
    tx.agentSession.findUnique.mockResolvedValue({
      id: 'session-delayed',
      status: 'active',
      endedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    tx.agentLifecycleEvent.findFirst.mockResolvedValue({
      occurredAt: new Date('2020-01-01T00:00:00.000Z'),
      receivedAt: new Date(),
    });

    const result = await cron.tick();

    expect(result.skippedRecent).toBe(1);
    expect(result.abandoned).toBe(0);
    expect(tx.agentSession.updateMany).not.toHaveBeenCalled();
  });

  it('preserves a stale session while an active work unit remains open', async () => {
    const { cron, prisma, tx, metrics } = makeCron();
    prisma.agentSession.findMany.mockResolvedValue([
      { id: 'session-3', correlationId: 'correlation-3' },
    ]);
    tx.agentSession.findUnique.mockResolvedValue({
      id: 'session-3',
      status: 'active',
      endedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    tx.agentLifecycleEvent.findFirst.mockResolvedValue(null);
    tx.agentWorkUnit.findFirst.mockResolvedValue({ id: 'work-unit-1' });

    const result = await cron.tick();

    expect(result.skippedActiveWork).toBe(1);
    expect(result.abandoned).toBe(0);
    expect(tx.agentSession.updateMany).not.toHaveBeenCalled();
    expect(metrics.getCounter('agent_session_reconciliation_skipped{reason=active_work_unit}')).toBe(1);
  });

  it('does not touch terminal sessions even if they appear in the candidate race', async () => {
    const { cron, prisma, tx } = makeCron();
    prisma.agentSession.findMany.mockResolvedValue([
      { id: 'session-4', correlationId: 'correlation-4' },
    ]);
    tx.agentSession.findUnique.mockResolvedValue({
      id: 'session-4',
      status: 'ended',
      endedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await cron.tick();

    expect(result.skippedTerminal).toBe(1);
    expect(tx.agentSession.updateMany).not.toHaveBeenCalled();
  });

  it('skips the database scan when another replica owns the lease', async () => {
    const { cron, prisma } = makeCron();
    vi.mocked(cronLease.acquireCronLease).mockResolvedValue(false);

    const result = await cron.tick();

    expect(result).toEqual({
      acquired: false,
      scanned: 0,
      abandoned: 0,
      skippedRecent: 0,
      skippedActiveWork: 0,
      skippedTerminal: 0,
      errors: 0,
    });
    expect(prisma.agentSession.findMany).not.toHaveBeenCalled();
  });
});
