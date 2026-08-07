import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentLifecycleEventV1 } from '@waitlayer/agent-protocol';

import { AgentBridgeClient } from '../src/agent-bridge-client';

const sockets: net.Server[] = [];
const directories: string[] = [];
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = 'installation-bridge-test';

function makeEvent(): AgentLifecycleEventV1 {
  return {
    schemaVersion: 1,
    eventId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'bridge-test-event',
    environmentKind: 'test',
    environmentId: 'test-run',
    installationId: INSTALLATION_ID,
    deviceId: DEVICE_ID,
    provider: 'claude_code',
    integrationMode: 'native_hook',
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.8,
    occurredAt: new Date().toISOString(),
    correlationId: 'bridge-correlation',
    adapterVersion: 'test',
    clientVersion: 'test',
    metadata: {},
  };
}

function makePaths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-vscode-bridge-'));
  directories.push(directory);
  return {
    socketPath: path.join(directory, 'events.sock'),
    secretPath: path.join(directory, 'bridge.secret'),
  };
}

function listen(server: net.Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => server.listen(socketPath, resolve));
}

afterEach(async () => {
  for (const server of sockets.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('AgentBridgeClient', () => {
  it('authenticates and receives a fragmented canonical event without sending it back', async () => {
    const paths = makePaths();
    fs.writeFileSync(paths.secretPath, `${'s'.repeat(43)}\n`, { mode: 0o600 });
    let resolveConnectionClosed!: () => void;
    let rejectConnectionClosed!: (error: Error) => void;
    const connectionClosed = new Promise<void>((resolve, reject) => {
      resolveConnectionClosed = resolve;
      rejectConnectionClosed = reject;
    });
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.once('error', rejectConnectionClosed);
      socket.once('close', resolveConnectionClosed);
      socket.once('data', (chunk) => {
        expect(chunk).toContain('subscribe');
        socket.write('{"type":"subscribed","protocolVersion":1}\n');
        const payload = JSON.stringify({ type: 'agent_event', event: makeEvent() });
        socket.write(payload.slice(0, 12));
        setTimeout(() => socket.end(`${payload.slice(12)}\n`), 1);
      });
    });
    sockets.push(server);
    await listen(server, paths.socketPath);
    let resolveEvent!: (event: AgentLifecycleEventV1) => void;
    const received = new Promise<AgentLifecycleEventV1>((resolve) => {
      resolveEvent = resolve;
    });
    const client = new AgentBridgeClient({
      socketPath: paths.socketPath,
      secretPath: paths.secretPath,
      reconnect: false,
      onEvent: resolveEvent,
    });
    client.start();
    const event = await received;
    await connectionClosed;
    client.dispose();
    expect(event.eventId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('uses the default bridge event socket and can be disposed before reconnect', () => {
    const paths = makePaths();
    const errors: unknown[] = [];
    const client = new AgentBridgeClient({
      socketPath: paths.socketPath,
      secretPath: paths.secretPath,
      onEvent: () => undefined,
      onError: (error) => errors.push(error),
    });
    client.start();
    client.dispose();
    expect(errors).toHaveLength(0);
  });
});
