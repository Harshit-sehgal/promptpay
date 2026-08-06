import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AGENT_PROTOCOL_VERSION,
  agentLifecycleEventSchema,
  AgentLifecycleEventV1,
  canonicalAgentBatchPayloadFromUnknown,
  getAgentProtocolCompatibility,
  isAgentEventTimestampBounded,
  sanitizeHookPayload,
  scanForbiddenAgentFields,
} from '@waitlayer/agent-protocol';
import { Prisma } from '@waitlayer/db';
import { verifySignature } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { AgentAnalyticsQueryDto, AgentEventsBatchDto } from './dto';

type RejectedAgentEvent = { eventId: string; reason: string };
type IngestedAgentEvent = { eventId: string; duplicate: boolean };

type WorkUnitDescriptor = {
  key: string;
  kind: string;
  status: string;
  startedAt: Date;
  endedAt?: Date;
  outcomeCategory?: string;
};

const OPPORTUNITY_TTL_MS = 15 * 60 * 1000;
const MIN_FOREGROUND_WAIT_MS = 30 * 1000;
const MAX_OPPORTUNITY_TRIGGER_AGE_MS = 15 * 60 * 1000;
const OPPORTUNITY_CONFIDENCE_CAP = 0.8;

@Injectable()
export class AgentService {
  private readonly environmentKind: string;
  private readonly environmentId: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.environmentKind = config.get<string>('WAITLAYER_ENVIRONMENT_KIND', 'development');
    this.environmentId = config.get<string>('WAITLAYER_ENVIRONMENT_ID', 'local');
  }

  async getAnalytics(userId: string, query: AgentAnalyticsQueryDto) {
    const end = query.to ? new Date(query.to) : new Date();
    const start = query.from
      ? new Date(query.from)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const maxWindowMs = 31 * 24 * 60 * 60 * 1000;
    if (start >= end) {
      throw new BadRequestException('Analytics start must be before analytics end');
    }
    if (end.getTime() - start.getTime() > maxWindowMs) {
      throw new BadRequestException('Analytics range cannot exceed 31 days');
    }
    if (
      end.getTime() - start.getTime() < 0 ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime())
    ) {
      throw new BadRequestException('Analytics range must contain valid timestamps');
    }

    const page = Math.min(Math.max(Math.trunc(query.page ?? 1), 1), 1000);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 25), 1), 100);
    const where = {
      userId,
      startedAt: { gte: start, lt: end },
    } as const;
    const [sessions, total, providerRows, statusRows, workUnitRows, opportunityRows] =
      await Promise.all([
        this.prisma.agentSession.findMany({
          where,
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            provider: true,
            integrationMode: true,
            status: true,
            startedAt: true,
            endedAt: true,
            _count: { select: { events: true, workUnits: true } },
          },
        }),
        this.prisma.agentSession.count({ where }),
        this.prisma.agentSession.groupBy({
          by: ['provider'],
          where,
          _count: { _all: true },
        }),
        this.prisma.agentSession.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.agentWorkUnit.groupBy({
          by: ['kind', 'status'],
          where: { session: where },
          _count: { _all: true },
        }),
        this.prisma.adOpportunity.groupBy({
          by: ['placementType', 'state'],
          where: { userId, createdAt: { gte: start, lt: end } },
          _count: { _all: true },
        }),
      ]);

    return {
      mode: 'agent_telemetry',
      financialSideEffects: false,
      environmentId: this.environmentId,
      range: { from: start.toISOString(), to: end.toISOString() },
      page,
      limit,
      total,
      sessions: sessions.map((session) => ({
        id: session.id,
        provider: session.provider,
        integrationMode: session.integrationMode,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs:
          session.endedAt && session.endedAt.getTime() >= session.startedAt.getTime()
            ? session.endedAt.getTime() - session.startedAt.getTime()
            : null,
        eventCount: session._count.events,
        workUnitCount: session._count.workUnits,
      })),
      aggregates: {
        byProvider: providerRows.map((row) => ({
          provider: row.provider,
          sessions: row._count._all,
        })),
        byStatus: statusRows.map((row) => ({
          status: row.status,
          sessions: row._count._all,
        })),
        workUnits: workUnitRows.map((row) => ({
          kind: row.kind,
          status: row.status,
          count: row._count._all,
        })),
        opportunities: opportunityRows.map((row) => ({
          placementType: row.placementType,
          state: row.state,
          count: row._count._all,
        })),
        opportunityMetrics: summarizeOpportunityMetrics(opportunityRows),
      },
    };
  }

  async ingestBatch(userId: string, dto: AgentEventsBatchDto, protocolVersionHeader?: string) {
    const payloadCompatibility = getAgentProtocolCompatibility(dto.schemaVersion);
    if (!payloadCompatibility.supported) {
      throw unsupportedProtocolVersion(payloadCompatibility.reason, payloadCompatibility.version);
    }
    if (protocolVersionHeader !== undefined) {
      const headerCompatibility = getAgentProtocolCompatibility(protocolVersionHeader);
      if (
        !headerCompatibility.supported ||
        headerCompatibility.version !== AGENT_PROTOCOL_VERSION
      ) {
        throw unsupportedProtocolVersion(headerCompatibility.reason, headerCompatibility.version);
      }
    }
    if (dto.environmentId !== this.environmentId) {
      throw new BadRequestException({
        code: 'agent_environment_mismatch',
        message: 'Agent event batch environment does not match the API environment',
        environmentId: this.environmentId,
      });
    }
    if (dto.events.length === 0 || dto.events.length > 100) {
      throw new BadRequestException({
        code: 'agent_protocol_invalid_batch',
        message: 'Agent event batch must contain between 1 and 100 events',
      });
    }
    const rejected: RejectedAgentEvent[] = [];
    const sanitizedEvents: AgentLifecycleEventV1[] = [];
    for (const candidate of dto.events) {
      const candidateEventId = readCandidateEventId(candidate);
      const parsedEvent = agentLifecycleEventSchema.safeParse(candidate);
      if (!parsedEvent.success) {
        rejected.push({ eventId: candidateEventId, reason: 'invalid' });
        continue;
      }
      const event = parsedEvent.data;
      let sanitizedEvent: AgentLifecycleEventV1;
      try {
        sanitizedEvent = {
          ...event,
          metadata: sanitizeHookPayload(event.provider, event.eventType, event.metadata).metadata,
        };
      } catch {
        rejected.push({ eventId: event.eventId, reason: 'forbidden_privacy_field' });
        continue;
      }
      if (event.environmentKind !== this.environmentKind) {
        rejected.push({ eventId: event.eventId, reason: 'environment_mismatch' });
        continue;
      }
      if (event.environmentId !== this.environmentId) {
        rejected.push({ eventId: event.eventId, reason: 'environment_mismatch' });
        continue;
      }
      if (event.installationId !== dto.installationId) {
        rejected.push({ eventId: event.eventId, reason: 'installation_mismatch' });
        continue;
      }
      if (event.deviceId && event.deviceId !== dto.deviceId) {
        rejected.push({ eventId: event.eventId, reason: 'device_mismatch' });
        continue;
      }
      if (!isAgentEventTimestampBounded(event.occurredAt)) {
        rejected.push({ eventId: event.eventId, reason: 'timestamp_out_of_range' });
        continue;
      }
      if (scanForbiddenAgentFields(candidate).length > 0) {
        rejected.push({ eventId: event.eventId, reason: 'forbidden_privacy_field' });
        continue;
      }
      sanitizedEvents.push(sanitizedEvent);
    }
    if (sanitizedEvents.length === 0) {
      throw new BadRequestException('Agent event batch contains no valid events');
    }
    const canonicalEvents = [...sanitizedEvents].sort(compareAgentEvents);

    const device = await this.prisma.device.findFirst({
      where: { id: dto.deviceId, userId },
      select: { id: true, eventSecret: true },
    });
    if (!device?.eventSecret) {
      throw new UnauthorizedException('Registered device secret is required');
    }

    if (
      !verifySignature(
        canonicalAgentBatchPayloadFromUnknown({
          schemaVersion: dto.schemaVersion,
          environmentId: dto.environmentId,
          installationId: dto.installationId,
          deviceId: dto.deviceId,
          events: dto.events,
        }),
        device.eventSecret,
        dto.signature,
      )
    ) {
      throw new UnauthorizedException('Invalid agent event batch signature');
    }

    const accepted: string[] = [];
    const duplicates: string[] = [];
    // Process each event in its own transaction. A malformed or conflicting
    // event must not roll back unrelated valid events in the same offline batch.
    for (const event of canonicalEvents) {
      try {
        const result = await this.ingestEvent(userId, dto.deviceId, event, dto.signature);
        if (result.duplicate) duplicates.push(result.eventId);
        else accepted.push(result.eventId);
      } catch (error) {
        if (this.isUniqueRace(error)) {
          const existing = await this.prisma.agentLifecycleEvent.findFirst({
            where: { OR: [{ eventId: event.eventId }, { idempotencyKey: event.idempotencyKey }] },
            select: {
              eventId: true,
              idempotencyKey: true,
              session: { select: { userId: true, deviceId: true } },
            },
          });
          if (
            existing?.session.userId === userId &&
            existing.session.deviceId === dto.deviceId &&
            existing.eventId === event.eventId &&
            existing.idempotencyKey === event.idempotencyKey
          ) {
            duplicates.push(event.eventId);
            continue;
          }
        }
        if (error instanceof ConflictException || error instanceof BadRequestException) {
          rejected.push({ eventId: event.eventId, reason: this.safeRejectionReason(error) });
          continue;
        }
        // Infrastructure failures must remain visible to the caller. Returning
        // a per-event rejection for a database outage would falsely suggest
        // that the batch was durably handled and could make a local queue drop
        // events that were never persisted.
        throw error;
      }
    }

    return {
      environmentKind: this.environmentKind,
      environmentId: this.environmentId,
      protocolVersion: AGENT_PROTOCOL_VERSION,
      accepted,
      duplicates,
      rejected,
      financialSideEffects: false,
    };
  }

  private async ingestEvent(
    userId: string,
    deviceId: string,
    event: AgentLifecycleEventV1,
    signature: string,
  ): Promise<IngestedAgentEvent> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize projection for one provider correlation. Without a database
      // lock, concurrent offline batches can both read the same latest event
      // and let a late session transition overwrite a newer state.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-session:${event.correlationId}`}))`;
      const existing = await tx.agentLifecycleEvent.findFirst({
        where: { OR: [{ eventId: event.eventId }, { idempotencyKey: event.idempotencyKey }] },
        select: {
          eventId: true,
          idempotencyKey: true,
          session: { select: { userId: true, deviceId: true } },
        },
      });
      if (existing) {
        if (
          existing.session.userId !== userId ||
          existing.session.deviceId !== deviceId ||
          existing.eventId !== event.eventId ||
          existing.idempotencyKey !== event.idempotencyKey
        ) {
          throw new ConflictException('Agent event idempotency conflict');
        }
        return { eventId: event.eventId, duplicate: true };
      }

      const existingSession = await tx.agentSession.findUnique({
        where: { correlationId: event.correlationId },
      });
      if (
        existingSession &&
        (existingSession.userId !== userId ||
          existingSession.deviceId !== deviceId ||
          existingSession.provider !== event.provider)
      ) {
        throw new ConflictException('Agent correlation belongs to another session');
      }
      if (existingSession?.status === 'abandoned') {
        // Reconciliation makes an abandoned correlation terminal. Reopening
        // it would let a replayed historical session.started/resumed event
        // reactivate the session and attach later telemetry to an old run.
        // Providers must begin a new correlation for a genuinely resumed run.
        throw new ConflictException('Agent session was already reconciled as abandoned');
      }

      const occurredAt = new Date(event.occurredAt);
      const latestEvent = existingSession
        ? await tx.agentLifecycleEvent.findFirst({
            where: { sessionId: existingSession.id },
            orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }, { eventId: 'desc' }],
            select: { occurredAt: true, sequence: true, eventId: true },
          })
        : null;
      const session =
        existingSession ??
        (await tx.agentSession.create({
          data: {
            id: randomUUID(),
            userId,
            deviceId,
            correlationId: event.correlationId,
            provider: event.provider,
            integrationMode: event.integrationMode,
            providerSessionHash: event.providerSessionHash,
            workspaceHash: event.workspaceHash,
            status: sessionStatusFor(event),
            adapterVersion: event.adapterVersion,
            providerVersion: event.providerVersion,
            startedAt: occurredAt,
          },
        }));

      const workUnit = await this.projectWorkUnit(tx, session.id, event, occurredAt);
      await tx.agentLifecycleEvent.create({
        data: {
          id: randomUUID(),
          sessionId: session.id,
          workUnitId: workUnit?.id,
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          schemaVersion: event.schemaVersion,
          environmentId: event.environmentId,
          eventType: event.eventType,
          // Client-declared provenance is never authoritative. Native hooks
          // are still client telemetry until an independent attester exists;
          // store them as inferred so a forged `observed` event cannot become
          // financial evidence through this endpoint.
          sourceType: 'inferred',
          confidence: Math.min(event.confidence, 0.8),
          occurredAt,
          sequence: event.sequence,
          correlationId: event.correlationId,
          causationId: event.causationId,
          metadata: event.metadata as Prisma.InputJsonValue,
          adapterVersion: event.adapterVersion,
          clientVersion: event.clientVersion,
          signature,
        },
      });

      // WL-061 is deliberately an agent-domain projection only. It inserts
      // candidate opportunities and never calls legacy ad selection, billing,
      // impressions, clicks, or ledger services.
      await this.maybeGenerateOpportunity(tx, userId, deviceId, session.id, event);

      const sessionUpdate =
        !latestEvent || isEventAtOrAfterLatest(event, latestEvent)
          ? sessionUpdateFor(event, occurredAt)
          : null;
      if (sessionUpdate) {
        await tx.agentSession.update({ where: { id: session.id }, data: sessionUpdate });
      }
      return { eventId: event.eventId, duplicate: false };
    });
  }

  private async maybeGenerateOpportunity(
    tx: Prisma.TransactionClient,
    userId: string,
    deviceId: string,
    sessionId: string,
    event: AgentLifecycleEventV1,
  ): Promise<void> {
    const placementType =
      event.eventType === 'surface.visible'
        ? 'foreground_wait'
        : event.eventType === 'user.returned'
          ? 'completion_return'
          : null;
    if (!placementType) return;

    const occurredAt = new Date(event.occurredAt);
    const now = Date.now();
    // Delayed offline telemetry must not create a stale surface opportunity.
    // This is an inventory projection, not a way to replay an old event into
    // an ad or financial path.
    if (
      occurredAt.getTime() < now - MAX_OPPORTUNITY_TRIGGER_AGE_MS ||
      occurredAt.getTime() > now + 5 * 60 * 1000
    ) {
      return;
    }

    let workUnitId: string | null = null;
    if (placementType === 'foreground_wait') {
      const [activeWorkUnit, processingStart] = await Promise.all([
        tx.agentWorkUnit.findFirst({
          where: { sessionId, status: 'active' },
          select: { id: true },
        }),
        tx.agentLifecycleEvent.findFirst({
          where: {
            sessionId,
            eventType: { in: ['turn.processing_started', 'task.created'] },
            occurredAt: { lt: occurredAt },
          },
          orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }, { eventId: 'desc' }],
          select: { occurredAt: true, workUnitId: true },
        }),
      ]);
      if (!activeWorkUnit || !processingStart) return;
      if (occurredAt.getTime() - processingStart.occurredAt.getTime() < MIN_FOREGROUND_WAIT_MS) {
        return;
      }
      workUnitId = activeWorkUnit.id;
    } else {
      const backgrounded = await tx.agentLifecycleEvent.findFirst({
        where: {
          sessionId,
          eventType: 'user.backgrounded',
          occurredAt: { lt: occurredAt },
        },
        orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }, { eventId: 'desc' }],
        select: { occurredAt: true },
      });
      if (!backgrounded) return;

      const completedWork = await tx.agentLifecycleEvent.findFirst({
        where: {
          sessionId,
          eventType: {
            in: ['turn.completed', 'task.completed', 'session.ended'],
          },
          occurredAt: { gt: backgrounded.occurredAt, lt: occurredAt },
        },
        orderBy: [{ occurredAt: 'desc' }, { sequence: 'desc' }, { eventId: 'desc' }],
        select: { workUnitId: true },
      });
      if (!completedWork) return;
      workUnitId = completedWork.workUnitId;
    }

    const idempotencyKey = `agent-opportunity:v1:${placementType}:${event.eventId}`;
    const eligibleAt = new Date();
    const expiresAt = new Date(eligibleAt.getTime() + OPPORTUNITY_TTL_MS);
    const confidence = Math.min(Math.max(event.confidence, 0), OPPORTUNITY_CONFIDENCE_CAP);

    await tx.adOpportunity.upsert({
      where: { idempotencyKey },
      create: {
        id: randomUUID(),
        userId,
        deviceId,
        sessionId,
        workUnitId,
        triggerEventId: event.eventId,
        placementType,
        state: 'candidate',
        attentionConfidence: confidence,
        integrationConfidence: confidence,
        eligibleAt,
        expiresAt,
        idempotencyKey,
      },
      update: {},
    });
  }

  private async projectWorkUnit(
    tx: Prisma.TransactionClient,
    sessionId: string,
    event: AgentLifecycleEventV1,
    occurredAt: Date,
  ) {
    const descriptor = workUnitDescriptorFor(event, occurredAt);
    if (!descriptor) return null;

    const existing = await tx.agentWorkUnit.findFirst({
      where: {
        sessionId,
        kind: descriptor.kind,
        providerWorkUnitHash: descriptor.key,
      },
    });
    if (existing) {
      const terminal = isTerminalWorkUnitStatus(existing.status);
      return tx.agentWorkUnit.update({
        where: { id: existing.id },
        data: {
          status: terminal ? undefined : descriptor.status,
          endedAt: terminal ? undefined : descriptor.endedAt,
          outcomeCategory: terminal ? undefined : descriptor.outcomeCategory,
          toolCallCount: event.eventType === 'tool.started' ? { increment: 1 } : undefined,
          subagentCount: event.eventType === 'subagent.started' ? { increment: 1 } : undefined,
        },
      });
    }
    try {
      return await tx.agentWorkUnit.create({
        data: {
          id: randomUUID(),
          sessionId,
          kind: descriptor.kind,
          providerWorkUnitHash: descriptor.key,
          status: descriptor.status,
          startedAt: descriptor.startedAt,
          endedAt: descriptor.endedAt,
          outcomeCategory: descriptor.outcomeCategory,
          toolCallCount: event.eventType === 'tool.started' ? 1 : 0,
          subagentCount: event.eventType === 'subagent.started' ? 1 : 0,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      // Another ingestion transaction won the unique work-unit race. Re-read
      // its row; the enclosing transaction will then persist this event and
      // the projector remains one-to-one with the provider work identity.
      const winner = await tx.agentWorkUnit.findFirst({
        where: {
          sessionId,
          kind: descriptor.kind,
          providerWorkUnitHash: descriptor.key,
        },
      });
      if (!winner) throw error;
      return tx.agentWorkUnit.update({
        where: { id: winner.id },
        data: {
          status: descriptor.status,
          endedAt: descriptor.endedAt,
          outcomeCategory: descriptor.outcomeCategory,
        },
      });
    }
  }

  private isUniqueRace(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private safeRejectionReason(error: unknown): string {
    if (
      error instanceof ConflictException &&
      error.message === 'Agent session was already reconciled as abandoned'
    ) {
      return 'abandoned_session';
    }
    if (error instanceof ConflictException) return 'conflict';
    if (error instanceof BadRequestException) return 'invalid';
    if (this.isUniqueRace(error)) return 'duplicate_race';
    return 'storage_error';
  }
}

function unsupportedProtocolVersion(
  reason: 'invalid' | 'unsupported',
  version: number | null,
): BadRequestException {
  return new BadRequestException({
    code:
      reason === 'invalid'
        ? 'agent_protocol_invalid_version'
        : 'agent_protocol_unsupported_version',
    message:
      reason === 'invalid'
        ? 'Agent protocol version must be an integer'
        : `Agent protocol version ${version} is not supported`,
    protocolVersion: AGENT_PROTOCOL_VERSION,
    receivedVersion: version,
  });
}

function readCandidateEventId(candidate: unknown): string {
  if (
    candidate &&
    typeof candidate === 'object' &&
    'eventId' in candidate &&
    typeof candidate.eventId === 'string' &&
    candidate.eventId.length <= 256
  ) {
    return candidate.eventId;
  }
  return '<unknown>';
}

function compareAgentEvents(left: AgentLifecycleEventV1, right: AgentLifecycleEventV1): number {
  const occurredAt = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  if (occurredAt !== 0) return occurredAt;
  const sequence =
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
  if (sequence !== 0) return sequence;
  return left.eventId.localeCompare(right.eventId);
}

function isEventAtOrAfterLatest(
  event: AgentLifecycleEventV1,
  latest: { occurredAt: Date; sequence: number | null; eventId: string },
): boolean {
  const occurredAt = Date.parse(event.occurredAt);
  const latestOccurredAt = latest.occurredAt.getTime();
  if (occurredAt !== latestOccurredAt) return occurredAt > latestOccurredAt;
  const sequence = event.sequence ?? Number.MAX_SAFE_INTEGER;
  const latestSequence = latest.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sequence !== latestSequence) return sequence > latestSequence;
  return event.eventId >= latest.eventId;
}

function isTerminalWorkUnitStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'stopped'].includes(status);
}

function summarizeOpportunityMetrics(
  rows: Array<{ placementType: string; state: string; _count: { _all: number } }>,
) {
  const total = rows.reduce((sum, row) => sum + row._count._all, 0);
  const claimed = rows
    .filter((row) => row.state === 'claimed')
    .reduce((sum, row) => sum + row._count._all, 0);
  const expired = rows
    .filter((row) => row.state === 'expired')
    .reduce((sum, row) => sum + row._count._all, 0);
  return {
    total,
    claimed,
    expired,
    claimRate: total === 0 ? 0 : Number((claimed / total).toFixed(4)),
  };
}

function sessionStatusFor(event: AgentLifecycleEventV1): string {
  if (event.eventType === 'session.ended') return 'ended';
  if (event.eventType === 'session.paused') return 'paused';
  return 'active';
}

function sessionUpdateFor(event: AgentLifecycleEventV1, occurredAt: Date) {
  if (event.eventType === 'session.ended') return { status: 'ended', endedAt: occurredAt };
  if (event.eventType === 'session.paused') return { status: 'paused' };
  if (event.eventType === 'session.resumed' || event.eventType === 'session.started') {
    return { status: 'active' };
  }
  return null;
}

function workUnitDescriptorFor(
  event: AgentLifecycleEventV1,
  occurredAt: Date,
): WorkUnitDescriptor | null {
  const eventType = event.eventType;
  if (eventType.startsWith('turn.')) {
    const key = workUnitKey(event, event.providerTurnHash, 'turn');
    if (!key) return null;
    return {
      key,
      kind: 'turn',
      status: workUnitStatusFor(eventType),
      startedAt: occurredAt,
      endedAt: isTerminalWorkUnitEvent(eventType) ? occurredAt : undefined,
      outcomeCategory: outcomeCategoryFor(eventType),
    };
  }
  if (eventType.startsWith('tool.')) {
    const key = workUnitKey(event, event.providerTaskHash, 'tool');
    if (!key) return null;
    return {
      key,
      kind: 'tool',
      status: workUnitStatusFor(eventType),
      startedAt: occurredAt,
      endedAt: isTerminalWorkUnitEvent(eventType) ? occurredAt : undefined,
      outcomeCategory: outcomeCategoryFor(eventType),
    };
  }
  if (eventType.startsWith('subagent.')) {
    const key = workUnitKey(event, event.providerTaskHash, 'subagent');
    if (!key) return null;
    return {
      key,
      kind: 'subagent',
      status: workUnitStatusFor(eventType),
      startedAt: occurredAt,
      endedAt: isTerminalWorkUnitEvent(eventType) ? occurredAt : undefined,
      outcomeCategory: outcomeCategoryFor(eventType),
    };
  }
  if (eventType.startsWith('task.')) {
    const key = workUnitKey(event, event.providerTaskHash, 'task');
    if (!key) return null;
    return {
      key,
      kind: 'task',
      status: workUnitStatusFor(eventType),
      startedAt: occurredAt,
      endedAt: isTerminalWorkUnitEvent(eventType) ? occurredAt : undefined,
      outcomeCategory: outcomeCategoryFor(eventType),
    };
  }
  return null;
}

function workUnitKey(
  event: AgentLifecycleEventV1,
  providerHash: string | undefined,
  kind: string,
): string | null {
  if (providerHash) return providerHash;
  if (event.causationId) return `${kind}:${event.causationId}`;
  return null;
}

function workUnitStatusFor(eventType: string): string {
  if (eventType.endsWith('.failed')) return 'failed';
  if (eventType.endsWith('.cancelled')) return 'cancelled';
  if (eventType.endsWith('.completed') || eventType.endsWith('.succeeded')) return 'completed';
  if (eventType.endsWith('.stopped')) return 'stopped';
  return 'active';
}

function isTerminalWorkUnitEvent(eventType: string): boolean {
  return ['.completed', '.succeeded', '.failed', '.cancelled', '.stopped'].some((suffix) =>
    eventType.endsWith(suffix),
  );
}

function outcomeCategoryFor(eventType: string): string | undefined {
  if (eventType.endsWith('.completed') || eventType.endsWith('.succeeded')) return 'success';
  if (eventType.endsWith('.failed')) return 'failure';
  if (eventType.endsWith('.cancelled')) return 'cancelled';
  return undefined;
}
