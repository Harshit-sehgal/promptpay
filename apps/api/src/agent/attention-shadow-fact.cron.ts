import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import {
  agentLifecycleEventSchema,
  type AgentLifecycleEventV1,
  canonicalAgentMetadataSchema,
  shadowAttentionPolicySchema,
} from '@ateva/agent-protocol';

import { backgroundJobsEnabled } from '../common/utils/background-jobs';
import { PrismaService } from '../config/prisma.service';
import { AttentionShadowFactService } from './attention-shadow-fact.service';
import { buildShadowSessionFact } from './attention-shadow-facts';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

export type AttentionShadowFactRunResult = {
  scanned: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: number;
  financialSideEffects: false;
};

/**
 * Materializes completed, policy-bound agent sessions into immutable shadow
 * facts. It is intentionally opt-in: without an operator-managed
 * `ATTENTION_SHADOW_PSEUDONYM_KEY`, the job does no work. That prevents raw
 * identifiers or an accidental development key from entering the dataset.
 */
@Injectable()
export class AttentionShadowFactCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AttentionShadowFactCron.name);
  private readonly intervalMs = positiveDuration(
    process.env.ATTENTION_SHADOW_FACT_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
  );
  private intervalId?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: AttentionShadowFactService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundJobsEnabled()) return;
    if (!process.env.ATTENTION_SHADOW_PSEUDONYM_KEY?.trim()) {
      this.logger.warn('Shadow fact materialization disabled: pseudonym key is not configured');
      return;
    }
    void this.tick().catch((error: unknown) => {
      this.logger.error('Initial shadow fact materialization failed', error);
    });
    this.intervalId = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error('Shadow fact materialization failed', error);
      });
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async tick(): Promise<AttentionShadowFactRunResult> {
    if (this.running) return emptyResult();
    const pseudonymKey = process.env.ATTENTION_SHADOW_PSEUDONYM_KEY?.trim();
    if (!pseudonymKey) return emptyResult();

    this.running = true;
    const result = emptyResult();
    try {
      const sessions = await this.prisma.agentSession.findMany({
        where: {
          status: { in: ['ended', 'abandoned'] },
          endedAt: { not: null },
        },
        orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          userId: true,
          deviceId: true,
          provider: true,
          integrationMode: true,
          startedAt: true,
          endedAt: true,
        },
      });
      result.scanned = sessions.length;

      for (const session of sessions) {
        const [existingFact, assignment] = await Promise.all([
          this.prisma.attentionSessionFact.findUnique({
            where: { sessionId: session.id },
            select: { id: true },
          }),
          this.prisma.attentionSessionPolicyAssignment.findUnique({
            where: { sessionId: session.id },
            select: {
              policy: {
                select: {
                  version: true,
                  status: true,
                  alphaPpm: true,
                  passiveCapRatioPpm: true,
                  passiveSessionCapMs: true,
                  minimumQualifiedMs: true,
                },
              },
            },
          }),
        ]);

        if (!session.endedAt || existingFact || !assignment) {
          result.skipped++;
          continue;
        }
        try {
          const storedEvents = await this.prisma.agentLifecycleEvent.findMany({
            where: { sessionId: session.id },
            orderBy: [{ occurredAt: 'asc' }, { sequence: 'asc' }, { eventId: 'asc' }],
            select: {
              schemaVersion: true,
              eventId: true,
              idempotencyKey: true,
              environmentId: true,
              eventType: true,
              sourceType: true,
              confidence: true,
              occurredAt: true,
              sequence: true,
              correlationId: true,
              causationId: true,
              adapterVersion: true,
              clientVersion: true,
              metadata: true,
            },
          });
          const events = storedEvents.map((event) => toCanonicalEvent(event, session));
          const policy = shadowAttentionPolicySchema.parse({
            version: assignment.policy.version,
            status: assignment.policy.status,
            alphaPpm: assignment.policy.alphaPpm,
            passiveCapRatioPpm: assignment.policy.passiveCapRatioPpm,
            passiveSessionCapMs: assignment.policy.passiveSessionCapMs,
            minimumQualifiedMs: assignment.policy.minimumQualifiedMs,
          });
          const built = buildShadowSessionFact({
            sessionId: session.id,
            userId: session.userId,
            deviceId: session.deviceId,
            pseudonymKey,
            environmentKind: resolveEnvironmentKind(),
            environmentId: events[0]?.environmentId ?? 'unknown',
            provider: session.provider,
            integrationMode: session.integrationMode,
            events,
            policy,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
          });
          const persisted = await this.facts.persist(session.id, built.fact);
          if (persisted.status === 'created') result.created++;
          else result.duplicates++;
        } catch (error: unknown) {
          result.errors++;
          this.logger.error(
            'Failed to materialize one shadow session fact',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}

function toCanonicalEvent(
  event: {
    schemaVersion: number;
    eventId: string;
    idempotencyKey: string;
    environmentId: string;
    eventType: string;
    sourceType: string;
    confidence: number;
    occurredAt: Date;
    sequence: number | null;
    correlationId: string;
    causationId: string | null;
    adapterVersion: string;
    clientVersion: string;
    metadata: unknown;
  },
  session: { provider: string; integrationMode: string; deviceId: string },
): AgentLifecycleEventV1 {
  return agentLifecycleEventSchema.parse({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    environmentKind: resolveEnvironmentKind(),
    environmentId: event.environmentId,
    installationId: 'server-reconstructed-installation',
    deviceId: session.deviceId,
    provider: session.provider,
    integrationMode: session.integrationMode,
    eventType: event.eventType,
    sourceType: event.sourceType,
    confidence: event.confidence,
    occurredAt: event.occurredAt.toISOString(),
    ...(event.sequence === null ? {} : { sequence: event.sequence }),
    correlationId: event.correlationId,
    ...(event.causationId ? { causationId: event.causationId } : {}),
    adapterVersion: event.adapterVersion,
    clientVersion: event.clientVersion,
    metadata: canonicalAgentMetadataSchema.parse(event.metadata),
  });
}

function resolveEnvironmentKind(): AgentLifecycleEventV1['environmentKind'] {
  const value = process.env.ATEVA_ENVIRONMENT_KIND;
  return value === 'development' ||
    value === 'test' ||
    value === 'sandbox' ||
    value === 'staging' ||
    value === 'production'
    ? value
    : 'development';
}

function positiveDuration(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function emptyResult(): AttentionShadowFactRunResult {
  return {
    scanned: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    financialSideEffects: false,
  };
}
