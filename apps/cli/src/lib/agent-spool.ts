import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  agentLifecycleEventSchema,
  AgentLifecycleEventV1,
  scanForbiddenAgentFields,
} from '@waitlayer/agent-protocol';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_QUEUE_EVENTS = 10_000;
const MAX_QUEUE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_STORAGE_BYTES = 20 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 2_000;
const STALE_LOCK_MS = 30_000;

type SpoolRecord = {
  queuedAt: string;
  installationId: string;
  deviceId: string;
  event: AgentLifecycleEventV1;
};

type QuarantineRecord = SpoolRecord & {
  quarantinedAt: string;
  reason: string;
};

export type SpoolPaths = {
  directory: string;
  queueFile: string;
  inFlightFile: string;
  quarantineFile: string;
  lockFile: string;
  bridgeSocket: string;
  bridgeEventsSocket: string;
  bridgeSecretFile: string;
  bridgeDisabledFile: string;
  bridgePidFile: string;
};

export type SpoolStatus = {
  queuedEvents: number;
  inFlightEvents: number;
  quarantinedEvents: number;
  bytes: number;
  oldestQueuedAt?: string;
  oldestEventAt?: string;
};

export type BatchResult = {
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ eventId: string; reason: string }>;
};

export type FlushResult = {
  claimed: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  remaining: number;
};

export function getWaitLayerDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  if (process.platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'WaitLayer');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homeDirectory, '.config'), 'waitlayer');
}

export function getSpoolPaths(directory = getWaitLayerDataDirectory()): SpoolPaths {
  return {
    directory,
    queueFile: path.join(directory, 'agent-events.jsonl'),
    inFlightFile: path.join(directory, 'agent-events.inflight.jsonl'),
    quarantineFile: path.join(directory, 'agent-events.quarantine.jsonl'),
    lockFile: path.join(directory, 'agent-events.lock'),
    bridgeSocket:
      process.platform === 'win32'
        ? '\\\\.\\pipe\\waitlayer-bridge'
        : path.join(directory, 'bridge.sock'),
    bridgeEventsSocket:
      process.platform === 'win32'
        ? '\\\\.\\pipe\\waitlayer-bridge-events'
        : path.join(directory, 'bridge-events.sock'),
    bridgeSecretFile: path.join(directory, 'bridge.secret'),
    bridgeDisabledFile: path.join(directory, 'bridge.disabled'),
    bridgePidFile: path.join(directory, 'bridge.pid'),
  };
}

export function enqueueAgentEvent(
  input: {
    installationId: string;
    deviceId: string;
    event: unknown;
  },
  paths = getSpoolPaths(),
  now = new Date(),
): void {
  const parsed = agentLifecycleEventSchema.safeParse(input.event);
  if (!parsed.success) throw new Error('Cannot spool an invalid agent lifecycle event');
  if (scanForbiddenAgentFields(parsed.data).length > 0) {
    throw new Error('Cannot spool an agent event containing forbidden privacy data');
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.deviceId)) {
    throw new Error('Cannot spool an agent event without a valid device id');
  }
  if (input.installationId.length < 16 || input.installationId.length > 256) {
    throw new Error('Cannot spool an agent event without a valid installation id');
  }
  if (parsed.data.installationId !== input.installationId) {
    throw new Error('Cannot spool an event for a different installation');
  }
  if (parsed.data.deviceId && parsed.data.deviceId !== input.deviceId) {
    throw new Error('Cannot spool an event for a different device');
  }

  withAgentSpoolLock(paths, () => {
    ensureDirectory(paths.directory);
    if (fs.existsSync(paths.bridgeDisabledFile)) {
      throw new Error('WaitLayer agent telemetry is disabled until the next successful login');
    }
    const records = readRecords(paths.queueFile, paths, now);
    const inFlight = readRecords(paths.inFlightFile, paths, now);
    const record: SpoolRecord = {
      queuedAt: now.toISOString(),
      installationId: input.installationId,
      deviceId: input.deviceId,
      event: parsed.data,
    };
    if (
      [...records, ...inFlight].some((existing) => existing.event.eventId === record.event.eventId)
    ) {
      return;
    }
    if (records.length >= MAX_QUEUE_EVENTS) {
      throw new Error('WaitLayer agent event queue is full');
    }
    const line = `${JSON.stringify(record)}\n`;
    if (fileSize(paths.queueFile) + Buffer.byteLength(line) > MAX_QUEUE_BYTES) {
      throw new Error('WaitLayer agent event queue has reached its storage limit');
    }
    if (spoolBytes(paths) + Buffer.byteLength(line) > MAX_TOTAL_STORAGE_BYTES) {
      throw new Error('WaitLayer agent spool has reached its total storage limit');
    }
    appendDurably(paths.queueFile, line);
  });
}

export function readSpoolStatus(paths = getSpoolPaths(), now = new Date()): SpoolStatus {
  return withAgentSpoolLock(paths, () => {
    ensureDirectory(paths.directory);
    const queue = readRecords(paths.queueFile, paths, now);
    const inFlight = readRecords(paths.inFlightFile, paths, now);
    const quarantine = readQuarantineRecords(paths.quarantineFile);
    const all = [...queue, ...inFlight];
    return {
      queuedEvents: queue.length,
      inFlightEvents: inFlight.length,
      quarantinedEvents: quarantine.length,
      bytes: [paths.queueFile, paths.inFlightFile, paths.quarantineFile].reduce(
        (total, file) => total + fileSize(file),
        0,
      ),
      oldestQueuedAt: oldest(all, (record) => record.queuedAt),
      oldestEventAt: oldest(all, (record) => record.event.occurredAt),
    };
  });
}

export function claimAgentEventBatch(
  paths = getSpoolPaths(),
  maxEvents = 100,
  now = new Date(),
): SpoolRecord[] {
  return withAgentSpoolLock(paths, () => {
    ensureDirectory(paths.directory);
    const existing = readRecords(paths.inFlightFile, paths, now);
    if (existing.length > 0) {
      // A crash after the claim file was durably written but before the queue
      // rewrite completed leaves both copies. Remove the claimed IDs now; the
      // in-flight file remains the durable source of truth until acknowledgement.
      const claimedIds = new Set(existing.map((record) => record.event.eventId));
      const queue = readRecords(paths.queueFile, paths, now);
      writeRecords(
        paths.queueFile,
        queue.filter((record) => !claimedIds.has(record.event.eventId)),
      );
      return existing.slice(0, maxEvents);
    }

    const queue = readRecords(paths.queueFile, paths, now);
    if (queue.length === 0) return [];
    const first = queue[0];
    const claimed = queue
      .filter(
        (record) =>
          record.installationId === first.installationId && record.deviceId === first.deviceId,
      )
      .slice(0, maxEvents);
    const claimedIds = new Set(claimed.map((record) => record.event.eventId));
    // Persist the claim before removing the queue records. If the process dies
    // after this write, the next claimer removes any duplicate queue copies;
    // if it dies before this write, the original queue remains retryable.
    writeRecords(paths.inFlightFile, claimed);
    writeRecords(
      paths.queueFile,
      queue.filter((record) => !claimedIds.has(record.event.eventId)),
    );
    return claimed;
  });
}

export function completeAgentEventBatch(
  result: BatchResult,
  paths = getSpoolPaths(),
  now = new Date(),
): void {
  withAgentSpoolLock(paths, () => {
    const inFlight = readRecords(paths.inFlightFile, paths, now);
    if (inFlight.length === 0) return;
    const accepted = new Set([...result.accepted, ...result.duplicates]);
    const rejected = new Map(result.rejected.map((item) => [item.eventId, item.reason]));
    const unresolved: SpoolRecord[] = [];
    const quarantined: QuarantineRecord[] = [];
    for (const record of inFlight) {
      if (accepted.has(record.event.eventId)) continue;
      const reason = rejected.get(record.event.eventId);
      if (reason) {
        quarantined.push({ ...record, quarantinedAt: now.toISOString(), reason });
      } else {
        unresolved.push(record);
      }
    }
    if (quarantined.length > 0) {
      const quarantineContent = quarantined.map((record) => `${JSON.stringify(record)}\n`).join('');
      if (spoolBytes(paths) + Buffer.byteLength(quarantineContent) > MAX_TOTAL_STORAGE_BYTES) {
        throw new Error('WaitLayer agent spool quarantine has reached its storage limit');
      }
      appendDurably(paths.quarantineFile, quarantineContent);
    }
    writeRecords(paths.inFlightFile, unresolved);
  });
}

export async function flushAgentEventSpool(
  upload: (input: {
    installationId: string;
    deviceId: string;
    events: AgentLifecycleEventV1[];
  }) => Promise<BatchResult>,
  paths = getSpoolPaths(),
  now = new Date(),
): Promise<FlushResult> {
  const claimed = claimAgentEventBatch(paths, 100, now);
  if (claimed.length === 0) {
    return {
      claimed: 0,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      remaining: readSpoolStatus(paths, now).queuedEvents,
    };
  }
  const result = await upload({
    installationId: claimed[0].installationId,
    deviceId: claimed[0].deviceId,
    events: claimed.map((record) => record.event),
  });
  completeAgentEventBatch(result, paths, now);
  const status = readSpoolStatus(paths, now);
  return {
    claimed: claimed.length,
    accepted: result.accepted.length,
    duplicates: result.duplicates.length,
    rejected: result.rejected.length,
    remaining: status.queuedEvents + status.inFlightEvents,
  };
}

export function clearBridgeSecret(paths = getSpoolPaths()): void {
  withAgentSpoolLock(paths, () => {
    markBridgeDisabled(paths);
    removeBridgeRuntimeFiles(paths);
  });
}

/** Atomically invalidate the bridge and delete all locally queued telemetry. */
export function clearAgentTelemetry(paths = getSpoolPaths()): void {
  withAgentSpoolLock(paths, () => {
    markBridgeDisabled(paths);
    removeBridgeRuntimeFiles(paths);
    removeSpoolFiles(paths);
  });
}

export function enableBridge(paths = getSpoolPaths()): void {
  withAgentSpoolLock(paths, () => {
    try {
      fs.unlinkSync(paths.bridgeDisabledFile);
    } catch (error: unknown) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;
    }
  });
}

export function clearAgentEventSpool(paths = getSpoolPaths()): void {
  withAgentSpoolLock(paths, () => removeSpoolFiles(paths));
}

function readRecords(
  file: string,
  paths: SpoolPaths,
  now: Date,
  quarantineMalformed = true,
): SpoolRecord[] {
  const raw = readText(file);
  if (!raw) return [];
  const valid: SpoolRecord[] = [];
  const malformed: QuarantineRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const candidate = JSON.parse(line) as SpoolRecord;
      const parsed = agentLifecycleEventSchema.safeParse(candidate.event);
      if (
        typeof candidate.queuedAt !== 'string' ||
        typeof candidate.installationId !== 'string' ||
        typeof candidate.deviceId !== 'string' ||
        !parsed.success ||
        parsed.data.installationId !== candidate.installationId ||
        (parsed.data.deviceId && parsed.data.deviceId !== candidate.deviceId) ||
        scanForbiddenAgentFields(parsed.data).length > 0
      ) {
        throw new Error('invalid queued event');
      }
      const queuedAt = Date.parse(candidate.queuedAt);
      if (!Number.isFinite(queuedAt) || now.getTime() - queuedAt > DEFAULT_TTL_MS) {
        throw new Error('queued event expired');
      }
      valid.push({ ...candidate, event: parsed.data });
    } catch (error: unknown) {
      if (quarantineMalformed && error instanceof Error) {
        malformed.push({
          queuedAt: now.toISOString(),
          installationId: 'unknown',
          deviceId: 'unknown',
          event: emptyQuarantineEvent(),
          quarantinedAt: now.toISOString(),
          reason: error.message,
        });
      }
    }
  }
  if (malformed.length > 0) {
    const quarantineContent = malformed.map((record) => `${JSON.stringify(record)}\n`).join('');
    if (spoolBytes(paths) + Buffer.byteLength(quarantineContent) > MAX_TOTAL_STORAGE_BYTES) {
      throw new Error('WaitLayer agent spool quarantine has reached its storage limit');
    }
    appendDurably(paths.quarantineFile, quarantineContent);
  }
  if (valid.length !== raw.split('\n').filter(Boolean).length) writeRecords(file, valid);
  return valid;
}

function readQuarantineRecords(file: string): QuarantineRecord[] {
  return readText(file)
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as QuarantineRecord];
      } catch {
        return [];
      }
    });
}

function appendDurably(file: string, content: string): void {
  ensureDirectory(path.dirname(file));
  const handle = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(handle, content, undefined, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  chmodFile(file, 0o600);
}

function writeRecords(file: string, records: SpoolRecord[]): void {
  if (records.length === 0) {
    try {
      fs.unlinkSync(file);
    } catch (error: unknown) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;
    }
    return;
  }
  const directory = path.dirname(file);
  ensureDirectory(directory);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const content = records.map((record) => `${JSON.stringify(record)}\n`).join('');
    const handle = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeSync(handle, content, undefined, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    chmodFile(temporary, 0o600);
    fs.renameSync(temporary, file);
    chmodFile(file, 0o600);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The rename succeeded or the temporary write never completed.
    }
  }
}

export function withAgentSpoolLock<T>(paths: SpoolPaths, callback: () => T): T {
  ensureDirectory(paths.directory);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let handle: number | undefined;
  for (;;) {
    try {
      handle = fs.openSync(paths.lockFile, 'wx', 0o600);
      fs.writeSync(handle, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      break;
    } catch (error: unknown) {
      if (!isFileSystemError(error, 'EEXIST')) throw error;
      try {
        const stat = fs.statSync(paths.lockFile);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          const owner = JSON.parse(readText(paths.lockFile)) as { pid?: number };
          if (!owner.pid || !isProcessAlive(owner.pid)) fs.unlinkSync(paths.lockFile);
        }
      } catch {
        // A concurrent writer may have removed the lock; retry below.
      }
      if (Date.now() >= deadline) throw new Error('WaitLayer local event spool is busy');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    try {
      fs.closeSync(handle);
    } finally {
      try {
        fs.unlinkSync(paths.lockFile);
      } catch {
        // Best-effort cleanup; the stale-lock path handles crashed writers.
      }
    }
  }
}

function markBridgeDisabled(paths: SpoolPaths): void {
  fs.writeFileSync(paths.bridgeDisabledFile, 'disabled\n', { encoding: 'utf8', mode: 0o600 });
  chmodFile(paths.bridgeDisabledFile, 0o600);
}

function removeBridgeRuntimeFiles(paths: SpoolPaths): void {
  for (const file of [paths.bridgePidFile, paths.bridgeSecretFile]) {
    try {
      fs.unlinkSync(file);
    } catch (error: unknown) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;
    }
  }
}

function removeSpoolFiles(paths: SpoolPaths): void {
  for (const file of [paths.queueFile, paths.inFlightFile, paths.quarantineFile]) {
    try {
      fs.unlinkSync(file);
    } catch (error: unknown) {
      if (!isFileSystemError(error, 'ENOENT')) throw error;
    }
  }
}

function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodFile(directory, 0o700);
}

function chmodFile(file: string, mode: number): void {
  try {
    fs.chmodSync(file, mode);
  } catch {
    // Windows and some mounted filesystems do not expose POSIX modes.
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error: unknown) {
    if (isFileSystemError(error, 'ENOENT')) return '';
    throw error;
  }
}

function spoolBytes(paths: SpoolPaths): number {
  return [paths.queueFile, paths.inFlightFile, paths.quarantineFile].reduce(
    (total, file) => total + fileSize(file),
    0,
  );
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function oldest(
  records: SpoolRecord[],
  select: (record: SpoolRecord) => string,
): string | undefined {
  return records.map(select).sort()[0];
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isFileSystemError(error, 'EPERM');
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === code);
}

function emptyQuarantineEvent(): AgentLifecycleEventV1 {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    idempotencyKey: `quarantine-${randomUUID()}`,
    environmentKind: 'development',
    environmentId: 'local',
    installationId: 'quarantined-event',
    provider: 'unknown',
    integrationMode: 'heuristic_shadow',
    eventType: 'event.rejected',
    sourceType: 'derived',
    confidence: 0,
    occurredAt: new Date().toISOString(),
    correlationId: 'quarantine',
    adapterVersion: 'spool',
    clientVersion: 'spool',
    metadata: {},
  };
}
