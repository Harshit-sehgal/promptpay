import type { AgentIntegrationMode, AgentLifecycleEventV1 } from '@waitlayer/agent-protocol';

export type CorrelatedSessionStatus =
  | 'active'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'ended';

export type CorrelatedAgentSession = {
  key: string;
  installationId: string;
  deviceId?: string;
  provider: AgentLifecycleEventV1['provider'];
  providerFamily: string;
  integrationMode: AgentIntegrationMode;
  sourcePriority: number;
  status: CorrelatedSessionStatus;
  lastEventId: string;
  lastOccurredAt: string;
  lastSequence?: number;
  eventCount: number;
};

export type SessionCorrelationUpdate = {
  accepted: boolean;
  duplicate: boolean;
  session: CorrelatedAgentSession;
};

const SOURCE_PRIORITY: Record<AgentIntegrationMode, number> = {
  native_hook: 3,
  native_plugin: 3,
  wrapper: 2,
  vscode_observation: 1,
  heuristic_shadow: 0,
};

const FALLBACK_WINDOW_MS = 5 * 60_000;
const MAX_SEEN_EVENTS = 2_000;
const MAX_SESSIONS = 256;

/**
 * Correlates read-only bridge events for the VS Code attention layer.
 *
 * Exact provider-session/correlation identifiers win. During the rollout,
 * wrapper events may not have the native provider session hash, so a bounded
 * fallback matches only one same-installation/device/provider-family session
 * in a narrow time window. Ambiguous parallel sessions are kept separate.
 * Native sources outrank lower-priority observations and stale lower-priority
 * events cannot overwrite their lifecycle state.
 */
export class AgentSessionCorrelation {
  private readonly sessions = new Map<string, CorrelatedAgentSession>();
  private readonly seenEventIds = new Set<string>();

  accept(event: AgentLifecycleEventV1): SessionCorrelationUpdate {
    const existing = this.findSession(event);
    if (this.seenEventIds.has(event.eventId)) {
      return {
        accepted: false,
        duplicate: true,
        session: existing ?? this.createSession(this.keyFor(event), event),
      };
    }

    this.rememberEvent(event.eventId);
    const nextPriority = SOURCE_PRIORITY[event.integrationMode];
    const session = existing
      ? this.mergeSession(existing, event, nextPriority)
      : this.createSession(this.keyFor(event), event);
    this.sessions.set(session.key, session);
    this.trimSessions();
    return { accepted: true, duplicate: false, session };
  }

  get(key: string): CorrelatedAgentSession | undefined {
    return this.sessions.get(key);
  }

  values(): CorrelatedAgentSession[] {
    return [...this.sessions.values()];
  }

  clear(): void {
    this.sessions.clear();
    this.seenEventIds.clear();
  }

  private findSession(event: AgentLifecycleEventV1): CorrelatedAgentSession | undefined {
    const exactKeys = [event.providerSessionHash, event.correlationId].filter(
      (value): value is string => Boolean(value),
    );
    for (const key of exactKeys) {
      const exact = this.sessions.get(scopedKey(event, key));
      if (exact) return exact;
    }

    // An explicit provider session hash is an authoritative identity. If it
    // is unknown locally, create a new session rather than weakening it into
    // the rollout fallback and accidentally merging parallel provider runs.
    if (event.providerSessionHash) return undefined;
    const eventTime = Date.parse(event.occurredAt);
    if (!Number.isFinite(eventTime)) return undefined;
    const candidates = [...this.sessions.values()].filter((session) => {
      if (isTerminal(session.status)) return false;
      if (session.installationId !== event.installationId) return false;
      if (session.deviceId && event.deviceId && session.deviceId !== event.deviceId) return false;
      if (session.providerFamily !== providerFamily(event)) return false;
      const sessionTime = Date.parse(session.lastOccurredAt);
      return Number.isFinite(sessionTime) && Math.abs(eventTime - sessionTime) <= FALLBACK_WINDOW_MS;
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  private keyFor(event: AgentLifecycleEventV1): string {
    return scopedKey(event, event.providerSessionHash ?? event.correlationId);
  }

  private createSession(key: string, event: AgentLifecycleEventV1): CorrelatedAgentSession {
    return {
      key,
      installationId: event.installationId,
      ...(event.deviceId ? { deviceId: event.deviceId } : {}),
      provider: event.provider,
      providerFamily: providerFamily(event),
      integrationMode: event.integrationMode,
      sourcePriority: SOURCE_PRIORITY[event.integrationMode],
      status: statusForEvent(event.eventType),
      lastEventId: event.eventId,
      lastOccurredAt: event.occurredAt,
      ...(event.sequence !== undefined ? { lastSequence: event.sequence } : {}),
      eventCount: 1,
    };
  }

  private mergeSession(
    existing: CorrelatedAgentSession,
    event: AgentLifecycleEventV1,
    nextPriority: number,
  ): CorrelatedAgentSession {
    const preferredSource = nextPriority >= existing.sourcePriority;
    const newer = isNewer(event, existing);
    const updateLifecycle = newer && (preferredSource || nextPriority === existing.sourcePriority);
    return {
      ...existing,
      provider: preferredSource ? event.provider : existing.provider,
      providerFamily: preferredSource ? providerFamily(event) : existing.providerFamily,
      integrationMode: preferredSource ? event.integrationMode : existing.integrationMode,
      sourcePriority: Math.max(existing.sourcePriority, nextPriority),
      ...(updateLifecycle
        ? {
            status: statusForEvent(event.eventType),
            lastEventId: event.eventId,
            lastOccurredAt: event.occurredAt,
            ...(event.sequence !== undefined ? { lastSequence: event.sequence } : {}),
          }
        : {}),
      eventCount: existing.eventCount + 1,
    };
  }

  private rememberEvent(eventId: string): void {
    this.seenEventIds.add(eventId);
    while (this.seenEventIds.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest === undefined) break;
      this.seenEventIds.delete(oldest);
    }
  }

  private trimSessions(): void {
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
}

function scopedKey(event: AgentLifecycleEventV1, identity: string): string {
  return [event.installationId, event.deviceId ?? '', providerFamily(event), identity].join(':');
}

function providerFamily(event: AgentLifecycleEventV1): string {
  return event.metadata.executableFamily ?? event.provider;
}

function isNewer(event: AgentLifecycleEventV1, existing: CorrelatedAgentSession): boolean {
  if (event.sequence !== undefined && existing.lastSequence !== undefined) {
    if (event.sequence !== existing.lastSequence) return event.sequence > existing.lastSequence;
    if (event.occurredAt !== existing.lastOccurredAt) return event.occurredAt > existing.lastOccurredAt;
    return event.eventId > existing.lastEventId;
  }
  const eventTime = Date.parse(event.occurredAt);
  const existingTime = Date.parse(existing.lastOccurredAt);
  return Number.isFinite(eventTime) && (!Number.isFinite(existingTime) || eventTime >= existingTime);
}

function isTerminal(status: CorrelatedSessionStatus): boolean {
  return status === 'ended' || status === 'failed' || status === 'cancelled';
}

function statusForEvent(eventType: AgentLifecycleEventV1['eventType']): CorrelatedSessionStatus {
  if (eventType === 'input.required' || eventType === 'permission.required') {
    return 'waiting_for_input';
  }
  if (
    eventType === 'turn.completed' ||
    eventType === 'task.completed' ||
    eventType === 'session.ended'
  ) {
    return eventType === 'session.ended' ? 'ended' : 'completed';
  }
  if (eventType === 'turn.failed' || eventType === 'task.failed') return 'failed';
  if (eventType === 'turn.cancelled') return 'cancelled';
  return 'active';
}
