import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { acquireCronLease, renewCronLease } from '../common/utils/cron-lease';
import { PrismaService } from '../config/prisma.service';
import { MetricsService } from '../observability/metrics.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const MIN_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type ReconciliationReason = 'recent_event' | 'active_work_unit' | 'terminal' | 'abandoned';

export type AgentSessionReconciliationResult = {
  acquired: boolean;
  scanned: number;
  abandoned: number;
  skippedRecent: number;
  skippedActiveWork: number;
  skippedTerminal: number;
  errors: number;
};

/**
 * Conservatively closes agent sessions that have become orphaned.
 *
 * This is telemetry housekeeping only. It never changes work-unit rows,
 * attention windows, ad opportunities, or any financial model. A session is
 * abandoned only when it is still active, older than the recovery window, has
 * no recent lifecycle event, and has no active work unit. The final checks
 * happen under the same per-correlation advisory lock used by AgentService so
 * an in-flight ingestion cannot be mistaken for an orphan.
 */
@Injectable()
export class AgentSessionReconciliationCron
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AgentSessionReconciliationCron.name);
  private readonly ownerId = randomUUID();
  private intervalId?: NodeJS.Timeout;
  private running = false;

  private readonly intervalMs = clampDuration(
    process.env.AGENT_SESSION_RECONCILIATION_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS,
    MAX_INTERVAL_MS,
  );
  private readonly recoveryWindowMs = clampDuration(
    process.env.AGENT_SESSION_RECOVERY_WINDOW_MS,
    DEFAULT_RECOVERY_WINDOW_MS,
    MIN_RECOVERY_WINDOW_MS,
    MAX_RECOVERY_WINDOW_MS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!backgroundJobsEnabled()) return;
    this.logger.log(
      `Starting agent-session reconciliation cron (interval=${this.intervalMs}ms, recoveryWindow=${this.recoveryWindowMs}ms)...`,
    );
    void this.tick().catch((error: unknown) => {
      this.logger.error('Startup agent-session reconciliation failed', error);
    });
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Agent-session reconciliation cron stopped.');
    }
  }

  async tick(): Promise<AgentSessionReconciliationResult> {
    if (this.running) {
      this.logger.warn('Agent-session reconciliation already running — skipping overlapping run');
      return emptyResult(false);
    }
    this.running = true;
    let leaseAcquired = false;
    let leaseLost = false;
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      const leaseTtlMs = Math.max(this.intervalMs * 2, 60_000);
      leaseAcquired = await acquireCronLease(
        this.prisma,
        'agent-session-reconciliation',
        this.ownerId,
        leaseTtlMs,
      );
      if (!leaseAcquired) return emptyResult(false);

      heartbeat = setInterval(() => {
        void renewCronLease(
          this.prisma,
          'agent-session-reconciliation',
          this.ownerId,
          leaseTtlMs,
        ).then(
          (renewed) => {
            if (!renewed) {
              leaseLost = true;
              this.logger.error(
                'Lost agent-session reconciliation lease; stopping before the next candidate',
              );
            }
          },
          (error: unknown) =>
            this.logger.error('Failed to renew agent-session reconciliation lease', error),
        );
      }, Math.max(Math.floor(leaseTtlMs / 3), 10_000));
      heartbeat.unref?.();

      const cutoff = new Date(Date.now() - this.recoveryWindowMs);
      const candidates = await this.prisma.agentSession.findMany({
        where: { status: 'active', endedAt: null, updatedAt: { lt: cutoff } },
        select: { id: true, correlationId: true },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      });

      const result: AgentSessionReconciliationResult = {
        acquired: true,
        scanned: candidates.length,
        abandoned: 0,
        skippedRecent: 0,
        skippedActiveWork: 0,
        skippedTerminal: 0,
        errors: 0,
      };

      for (const candidate of candidates) {
        if (leaseLost) {
          result.errors++;
          break;
        }
        try {
          const reason = await this.reconcileCandidate(candidate, cutoff);
          if (reason === 'abandoned') result.abandoned++;
          else if (reason === 'recent_event') result.skippedRecent++;
          else if (reason === 'active_work_unit') result.skippedActiveWork++;
          else result.skippedTerminal++;
        } catch (error: unknown) {
          result.errors++;
          this.metrics.recordAgentSessionReconciliationError();
          this.logger.error(
            `Failed to reconcile agent session ${candidate.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      if (result.abandoned > 0) {
        this.logger.log(
          `Marked ${result.abandoned} stale agent session(s) abandoned; skipped ${result.skippedRecent} recent and ${result.skippedActiveWork} active-work session(s).`,
        );
      }
      this.metrics.recordAgentSessionReconciliation(result.abandoned, result.scanned);
      return result;
    } catch (error: unknown) {
      this.metrics.recordAgentSessionReconciliationError();
      this.logger.error(
        'Agent-session reconciliation failed',
        error instanceof Error ? error.stack : String(error),
      );
      return { ...emptyResult(leaseAcquired), errors: 1 };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.running = false;
    }
  }

  private async reconcileCandidate(
    candidate: { id: string; correlationId: string },
    cutoff: Date,
  ): Promise<ReconciliationReason> {
    const reason = await this.prisma.$transaction(async (tx) => {
      // AgentService uses this exact lock before reading/projecting a
      // correlation. Re-check all mutable state after acquiring it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-session:${candidate.correlationId}`}))`;

      const session = await tx.agentSession.findUnique({
        where: { id: candidate.id },
        select: { id: true, status: true, endedAt: true, updatedAt: true },
      });
      if (!session || session.status !== 'active' || session.endedAt !== null) return 'terminal';

      const [latestOccurredEvent, latestReceivedEvent] = await Promise.all([
        tx.agentLifecycleEvent.findFirst({
          where: { sessionId: session.id },
          orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }, { eventId: 'desc' }],
          select: { occurredAt: true },
        }),
        tx.agentLifecycleEvent.findFirst({
          where: { sessionId: session.id },
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          select: { receivedAt: true },
        }),
      ]);
      if (
        latestOccurredEvent?.occurredAt !== undefined &&
        latestOccurredEvent.occurredAt >= cutoff
      ) {
        return 'recent_event';
      }
      if (
        latestReceivedEvent?.receivedAt !== undefined &&
        latestReceivedEvent.receivedAt >= cutoff
      ) {
        return 'recent_event';
      }

      const activeWorkUnit = await tx.agentWorkUnit.findFirst({
        where: { sessionId: session.id, status: 'active' },
        select: { id: true },
      });
      if (activeWorkUnit) return 'active_work_unit';

      const updated = await tx.agentSession.updateMany({
        where: {
          id: session.id,
          status: 'active',
          endedAt: null,
          updatedAt: { lt: cutoff },
        },
        data: { status: 'abandoned', endedAt: new Date() },
      });
      return updated.count === 1 ? 'abandoned' : 'terminal';
    });

    if (reason === 'abandoned') this.metrics.recordAgentSessionAbandoned();
    else if (reason === 'recent_event') this.metrics.recordAgentSessionReconciliationSkipped('recent_event');
    else if (reason === 'active_work_unit') {
      this.metrics.recordAgentSessionReconciliationSkipped('active_work_unit');
    }
    return reason;
  }
}

function clampDuration(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
}

function emptyResult(acquired: boolean): AgentSessionReconciliationResult {
  return {
    acquired,
    scanned: 0,
    abandoned: 0,
    skippedRecent: 0,
    skippedActiveWork: 0,
    skippedTerminal: 0,
    errors: 0,
  };
}
