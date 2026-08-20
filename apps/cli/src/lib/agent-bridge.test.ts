import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentLifecycleEventSchema } from '@ateva/agent-protocol';

import {
  getBridgeStatus,
  getOrCreateBridgeSecret,
  sendAgentEventToBridge,
  startAgentBridge,
} from './agent-bridge';
import { getSpoolPaths, readSpoolStatus } from './agent-spool';

const directories: string[] = [];
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = 'installation-123456789';

function makeEvent() {
  return agentLifecycleEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    environmentKind: 'test',
    environmentId: 'test-run',
    installationId: INSTALLATION_ID,
    deviceId: DEVICE_ID,
    provider: 'generic_wrapper',
    integrationMode: 'wrapper',
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.5,
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    adapterVersion: 'test',
    clientVersion: 'test',
    metadata: {},
  });
}

function makePaths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ateva-bridge-'));
  directories.push(directory);
  return getSpoolPaths(directory);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('agent bridge', () => {
  it('creates one installation secret without overwriting a concurrent winner', () => {
    const paths = makePaths();
    const first = getOrCreateBridgeSecret(paths);
    const second = getOrCreateBridgeSecret(paths);
    expect(first).toHaveLength(43);
    expect(second).toBe(first);
    expect(fs.readFileSync(paths.bridgeSecretFile, 'utf8').trim()).toBe(first);
  });

  it('acknowledges an event only after the bridge persists it', async () => {
    const paths = makePaths();
    const bridge = await startAgentBridge({
      credentials: {
        email: 'dev@example.test',
        accessToken: 'a',
        refreshToken: 'r',
        userId: 'u',
        role: 'developer',
      },
      paths,
      uploadIntervalMs: 60_000,
    });
    try {
      await sendAgentEventToBridge(
        { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() },
        paths,
      );
      expect(readSpoolStatus(paths).queuedEvents).toBe(1);
    } finally {
      await bridge.stop();
    }
  });

  it('falls back to the spool when no bridge is running', async () => {
    const paths = makePaths();
    await sendAgentEventToBridge(
      { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() },
      paths,
    );
    expect(readSpoolStatus(paths).queuedEvents).toBe(1);
  });

  it('rejects a bridge with an invalid secret and does not enqueue the event', async () => {
    const paths = makePaths();
    const bridge = await startAgentBridge({
      credentials: {
        email: 'dev@example.test',
        accessToken: 'a',
        refreshToken: 'r',
        userId: 'u',
        role: 'developer',
      },
      paths,
      uploadIntervalMs: 60_000,
    });
    try {
      await expect(
        new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(paths.bridgeSocket);
          socket.once('connect', () => {
            socket.end(
              `${JSON.stringify({ secret: 'wrong', installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() })}\n`,
            );
          });
          socket.on('data', (data) => {
            expect(data.toString()).toContain('rejected');
            resolve();
          });
          socket.once('error', reject);
        }),
      ).resolves.toBeUndefined();
      expect(readSpoolStatus(paths).queuedEvents).toBe(0);
    } finally {
      await bridge.stop();
    }
  });

  it('authenticates event subscribers and broadcasts only after durable enqueue', async () => {
    const paths = makePaths();
    const bridge = await startAgentBridge({
      credentials: {
        email: 'dev@example.test',
        accessToken: 'a',
        refreshToken: 'r',
        userId: 'u',
        role: 'developer',
      },
      paths,
      uploadIntervalMs: 60_000,
    });
    try {
      const received = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(paths.bridgeEventsSocket);
        let buffer = '';
        let subscribed = false;
        socket.on('data', (data) => {
          buffer += data.toString();
          if (!subscribed && buffer.includes('"type":"subscribed"')) {
            subscribed = true;
            void sendAgentEventToBridge(
              { installationId: INSTALLATION_ID, deviceId: DEVICE_ID, event: makeEvent() },
              paths,
            ).catch(reject);
          }
          if (buffer.includes('"type":"agent_event"')) {
            resolve(buffer);
            socket.destroy();
          }
        });
        socket.once('connect', () =>
          socket.write(
            `${JSON.stringify({ action: 'subscribe', secret: fs.readFileSync(paths.bridgeSecretFile, 'utf8').trim() })}\n`,
          ),
        );
        socket.once('error', reject);
      });
      expect(received).toContain('"type":"agent_event"');
      expect(readSpoolStatus(paths).queuedEvents).toBe(1);
    } finally {
      await bridge.stop();
    }
  });

  it('rejects invalid event subscriptions', async () => {
    const paths = makePaths();
    const bridge = await startAgentBridge({
      credentials: {
        email: 'dev@example.test',
        accessToken: 'a',
        refreshToken: 'r',
        userId: 'u',
        role: 'developer',
      },
      paths,
      uploadIntervalMs: 60_000,
    });
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(paths.bridgeEventsSocket);
        socket.once('connect', () => socket.end('{"action":"subscribe","secret":"wrong"}\n'));
        socket.on('data', (data) => resolve(data.toString()));
        socket.once('error', reject);
      });
      expect(response).toContain('rejected');
    } finally {
      await bridge.stop();
    }
  });

  it('removes a refused stale socket before starting', async () => {
    const paths = makePaths();
    fs.mkdirSync(paths.directory, { recursive: true });
    const stale = net.createServer();
    await new Promise<void>((resolve) => stale.listen(paths.bridgeSocket, resolve));
    await new Promise<void>((resolve) => stale.close(() => resolve()));
    expect((await getBridgeStatus(paths)).running).toBe(false);
    const bridge = await startAgentBridge({
      credentials: {
        email: 'dev@example.test',
        accessToken: 'a',
        refreshToken: 'r',
        userId: 'u',
        role: 'developer',
      },
      paths,
      uploadIntervalMs: 60_000,
    });
    await bridge.stop();
    expect(fs.existsSync(paths.bridgeSocket)).toBe(false);
  });

  it('rolls back the ingest socket when the subscription socket cannot bind', async () => {
    const paths = makePaths();
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(paths.bridgeEventsSocket, resolve));
    try {
      await expect(
        startAgentBridge({
          credentials: {
            email: 'dev@example.test',
            accessToken: 'a',
            refreshToken: 'r',
            userId: 'u',
            role: 'developer',
          },
          paths,
          uploadIntervalMs: 60_000,
        }),
      ).rejects.toThrow('already running');
      expect(fs.existsSync(paths.bridgeSocket)).toBe(false);
      expect(fs.existsSync(paths.bridgePidFile)).toBe(false);
      expect(fs.existsSync(paths.bridgeEventsSocket)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
    expect(fs.existsSync(paths.bridgeSocket)).toBe(false);
  });
});
