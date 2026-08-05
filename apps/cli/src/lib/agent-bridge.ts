import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';

import { AgentLifecycleEventV1, canonicalAgentBatchPayload } from '@waitlayer/agent-protocol';

import {
  enqueueAgentEvent,
  flushAgentEventSpool,
  getSpoolPaths,
  readSpoolStatus,
  SpoolPaths,
  withAgentSpoolLock,
} from './agent-spool';
import { ApiClient } from './api-client';
import { Credentials } from './credentials';

const IPC_TIMEOUT_MS = 200;
const SUBSCRIPTION_AUTH_TIMEOUT_MS = 2_000;
const MAX_IPC_LINE_BYTES = 256 * 1024;
const UPLOAD_INTERVAL_MS = 5_000;

type IpcEnvelope = {
  secret: string;
  installationId: string;
  deviceId: string;
  event: AgentLifecycleEventV1;
};

export type BridgeStatus = ReturnType<typeof readSpoolStatus> & {
  running: boolean;
  socket: string;
};

/** Create the installation-local secret used to authenticate bridge clients. */
export function getOrCreateBridgeSecret(paths: SpoolPaths = getSpoolPaths()): string {
  return withAgentSpoolLock(paths, () => {
    fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(paths.bridgeDisabledFile)) {
      throw new Error('WaitLayer bridge is disabled until the next successful login');
    }
    try {
      const existing = fs.readFileSync(paths.bridgeSecretFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {
      // First run or a removed secret.
    }

    const generated = randomBytes(32).toString('base64url');
    try {
      const handle = fs.openSync(paths.bridgeSecretFile, 'wx', 0o600);
      try {
        fs.writeSync(handle, `${generated}\n`);
      } finally {
        fs.closeSync(handle);
      }
      return generated;
    } catch (error: unknown) {
      if (!isFileSystemError(error, 'EEXIST')) throw error;
      const winner = fs.readFileSync(paths.bridgeSecretFile, 'utf8').trim();
      if (winner.length < 32) throw new Error('WaitLayer bridge secret is invalid');
      return winner;
    }
  });
}

/**
 * Send one already-normalized event to the bridge. If the bridge is not
 * running, persist directly to the JSONL spool so a provider hook never loses
 * telemetry merely because the background process is stopped.
 */
export async function sendAgentEventToBridge(
  envelope: Omit<IpcEnvelope, 'secret'>,
  paths: SpoolPaths = getSpoolPaths(),
  timeoutMs = IPC_TIMEOUT_MS,
): Promise<void> {
  const secret = getOrCreateBridgeSecret(paths);
  const payload = JSON.stringify({ ...envelope, secret }) + '\n';
  if (Buffer.byteLength(payload) > MAX_IPC_LINE_BYTES) {
    throw new Error('Agent event is too large for the local bridge');
  }

  try {
    await sendIpcPayload(paths.bridgeSocket, payload, timeoutMs);
  } catch (error: unknown) {
    if (!isBridgeUnavailable(error)) throw error;
    enqueueAgentEvent(
      {
        installationId: envelope.installationId,
        deviceId: envelope.deviceId,
        event: envelope.event,
      },
      paths,
    );
  }
}

export async function startAgentBridge(options: {
  credentials: Credentials;
  paths?: SpoolPaths;
  uploadIntervalMs?: number;
  onError?: (error: unknown) => void;
}): Promise<{
  socket: net.Server;
  stop: () => Promise<void>;
  flush: () => Promise<Awaited<ReturnType<typeof flushAgentEventSpool>>>;
}> {
  const paths = options.paths ?? getSpoolPaths();
  const secret = getOrCreateBridgeSecret(paths);
  const api = new ApiClient(options.credentials);
  const upload = () => {
    try {
      if (fs.readFileSync(paths.bridgeSecretFile, 'utf8').trim() !== secret) {
        throw new Error('WaitLayer bridge credentials were cleared; restart the bridge');
      }
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        throw new Error('WaitLayer bridge credentials were cleared; restart the bridge');
      }
      throw error;
    }
    return flushAgentEventSpool(
      async ({ installationId, deviceId, events }) =>
        api.ingestAgentEvents({ installationId, deviceId, events }),
      paths,
    );
  };
  const subscribers = new Set<net.Socket>();
  const eventsServer = net.createServer((connection) => {
    let buffer = '';
    const authTimer = setTimeout(() => connection.destroy(), SUBSCRIPTION_AUTH_TIMEOUT_MS);
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_IPC_LINE_BYTES) {
        connection.destroy();
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(authTimer);
      const line = buffer.slice(0, newline);
      try {
        const request = JSON.parse(line) as { action?: string; secret?: string };
        if (
          request.action !== 'subscribe' ||
          request.secret !== secret ||
          readBridgeSecret(paths) !== secret ||
          fs.existsSync(paths.bridgeDisabledFile)
        ) {
          throw new Error('invalid bridge subscription');
        }
        subscribers.add(connection);
        connection.write('{"type":"subscribed","protocolVersion":1}\n');
        connection.on('close', () => subscribers.delete(connection));
        connection.on('error', () => subscribers.delete(connection));
      } catch (error) {
        options.onError?.(error);
        connection.end('{"type":"rejected"}\n');
      }
    });
    connection.on('error', (error) => options.onError?.(error));
  });

  const broadcast = (event: AgentLifecycleEventV1) => {
    const line = `${JSON.stringify({ type: 'agent_event', event })}\n`;
    for (const subscriber of subscribers) {
      if (readBridgeSecret(paths) !== secret || fs.existsSync(paths.bridgeDisabledFile)) {
        subscriber.destroy();
        subscribers.delete(subscriber);
        continue;
      }
      if (!subscriber.write(line)) {
        subscriber.destroy();
        subscribers.delete(subscriber);
      }
    }
  };

  const server = net.createServer((connection) => {
    let buffer = '';
    let bytes = 0;
    connection.setTimeout(IPC_TIMEOUT_MS, () => connection.destroy());
    connection.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_IPC_LINE_BYTES) {
        connection.destroy();
        return;
      }
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      try {
        const envelope = JSON.parse(line) as IpcEnvelope;
        if (envelope.secret !== secret) throw new Error('invalid bridge secret');
        if (readBridgeSecret(paths) !== secret) {
          throw new Error('bridge credentials were cleared');
        }
        if (envelope.event.installationId !== envelope.installationId) {
          throw new Error('event installation does not match bridge envelope');
        }
        if (envelope.event.deviceId && envelope.event.deviceId !== envelope.deviceId) {
          throw new Error('event device does not match bridge envelope');
        }
        enqueueAgentEvent(
          {
            installationId: envelope.installationId,
            deviceId: envelope.deviceId,
            event: envelope.event,
          },
          paths,
        );
        broadcast(envelope.event);
        connection.end('ok\n');
      } catch (error) {
        options.onError?.(error);
        connection.end('rejected\n');
      }
    });
    connection.on('error', (error) => options.onError?.(error));
  });

  let ingestSocketBound = false;
  let eventsSocketBound = false;
  try {
    if (paths.bridgeSocket.startsWith('\\\\.\\pipe\\')) {
      await listenServer(server, paths.bridgeSocket);
      ingestSocketBound = true;
    } else {
      await removeStaleBridgeSocket(paths.bridgeSocket);
      await listenServer(server, paths.bridgeSocket);
      ingestSocketBound = true;
      try {
        fs.chmodSync(paths.bridgeSocket, 0o600);
      } catch {
        // Best effort on filesystems without POSIX socket permissions.
      }
    }
    if (paths.bridgeEventsSocket.startsWith('\\\\.\\pipe\\')) {
      await listenServer(eventsServer, paths.bridgeEventsSocket);
      eventsSocketBound = true;
    } else {
      await removeStaleBridgeSocket(paths.bridgeEventsSocket);
      await listenServer(eventsServer, paths.bridgeEventsSocket);
      eventsSocketBound = true;
      try {
        fs.chmodSync(paths.bridgeEventsSocket, 0o600);
      } catch {
        // Best effort on filesystems without POSIX socket permissions.
      }
    }
    fs.writeFileSync(paths.bridgePidFile, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    await closeServerSafely(eventsServer);
    await closeServerSafely(server);
    const boundSockets = [
      ingestSocketBound ? paths.bridgeSocket : undefined,
      eventsSocketBound ? paths.bridgeEventsSocket : undefined,
    ];
    for (const socketPath of boundSockets) {
      if (!socketPath || socketPath.startsWith('\\\\.\\pipe\\')) continue;
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // The socket may already have been removed.
      }
    }
    try {
      if (fs.readFileSync(paths.bridgePidFile, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(paths.bridgePidFile);
      }
    } catch {
      // The marker may not have been written.
    }
    throw error;
  }

  let stopped = false;
  const stopBridge = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    for (const subscriber of subscribers) subscriber.destroy();
    subscribers.clear();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => eventsServer.close(() => resolve())),
    ]);
    if (!paths.bridgeSocket.startsWith('\\\\.\\pipe\\')) {
      try {
        fs.unlinkSync(paths.bridgeSocket);
      } catch {
        // The socket may already have been removed after a crash/restart.
      }
    }
    if (!paths.bridgeEventsSocket.startsWith('\\\\.\\pipe\\')) {
      try {
        fs.unlinkSync(paths.bridgeEventsSocket);
      } catch {
        // The socket may already have been removed after a crash/restart.
      }
    }
    try {
      if (fs.readFileSync(paths.bridgePidFile, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(paths.bridgePidFile);
      }
    } catch {
      // Logout or a prior stop may already have removed the marker.
    }
  };

  const interval = setInterval(() => {
    if (readBridgeSecret(paths) !== secret) {
      void stopBridge();
      return;
    }
    void upload().catch((error) => options.onError?.(error));
  }, options.uploadIntervalMs ?? UPLOAD_INTERVAL_MS);
  interval.unref?.();

  return { socket: server, stop: stopBridge, flush: upload };
}

export async function getBridgeStatus(paths = getSpoolPaths()): Promise<BridgeStatus> {
  return {
    ...readSpoolStatus(paths),
    running: !fs.existsSync(paths.bridgeDisabledFile) && (await isBridgeRunning(paths)),
    socket: paths.bridgeSocket,
  };
}

export function canonicalBridgeBatchPayload(input: {
  schemaVersion: 1;
  environmentId: string;
  installationId: string;
  deviceId: string;
  events: AgentLifecycleEventV1[];
}) {
  return canonicalAgentBatchPayload(input);
}

async function sendIpcPayload(
  socketPath: string,
  payload: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let response = '';
    const socket = net.createConnection(socketPath);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error('WaitLayer local bridge timed out'));
      socket.destroy();
    }, timeoutMs);
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.includes('ok\n')) finish();
      if (response.includes('rejected\n')) {
        finish(new Error('WaitLayer local bridge rejected the event'));
      }
    });
    socket.once('connect', () => socket.end(payload));
    socket.once('error', (error) => finish(error));
    socket.once('close', () => {
      if (!settled)
        finish(new Error('WaitLayer local bridge closed before acknowledging the event'));
    });
  });
}

function closeServerSafely(server: net.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function listenServer(server: net.Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

async function removeStaleBridgeSocket(socketPath: string): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const probe = net.createConnection(socketPath);
      const timer = setTimeout(() => {
        probe.destroy();
        reject(new Error('bridge socket probe timed out'));
      }, IPC_TIMEOUT_MS);
      probe.once('connect', () => {
        clearTimeout(timer);
        probe.end();
        reject(new Error('WaitLayer bridge is already running'));
      });
      probe.once('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (error.code === 'ENOENT') resolve();
        else if (error.code === 'ECONNREFUSED') {
          try {
            fs.unlinkSync(socketPath);
          } catch (unlinkError: unknown) {
            if (!isFileSystemError(unlinkError, 'ENOENT')) reject(unlinkError);
          }
          resolve();
        } else reject(error);
      });
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'WaitLayer bridge is already running') {
      throw error;
    }
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code !== 'ENOENT' &&
      (error as { code?: string }).code !== 'ECONNREFUSED'
    ) {
      throw error;
    }
  }
}

async function isBridgeRunning(paths: SpoolPaths): Promise<boolean> {
  if (paths.bridgeSocket.startsWith('\\\\.\\pipe\\')) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const probe = net.createConnection(paths.bridgeSocket);
      const timer = setTimeout(() => {
        probe.destroy();
        reject(new Error('bridge status probe timed out'));
      }, IPC_TIMEOUT_MS);
      probe.once('connect', () => {
        clearTimeout(timer);
        probe.end();
        resolve();
      });
      probe.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return true;
  } catch {
    return false;
  }
}

function readBridgeSecret(paths: SpoolPaths): string | null {
  try {
    return fs.readFileSync(paths.bridgeSecretFile, 'utf8').trim();
  } catch {
    return null;
  }
}

function isBridgeUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (
    code === 'ENOENT' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'ECONNRESET'
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /bridge (?:closed|timed out)|before acknowledging/i.test(message);
}

function isFileSystemError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === code);
}
