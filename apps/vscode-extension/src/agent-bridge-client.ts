import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';

import { agentLifecycleEventSchema, type AgentLifecycleEventV1 } from '@waitlayer/agent-protocol';

const MAX_LINE_BYTES = 256 * 1024;
const AUTH_TIMEOUT_MS = 2_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export type AgentBridgeClientOptions = {
  socketPath?: string;
  secretPath?: string;
  reconnect?: boolean;
  onEvent: (event: AgentLifecycleEventV1) => void;
  onError?: (error: unknown) => void;
  onConnectionChange?: (connected: boolean) => void;
};

/**
 * Read-only client for the CLI's local event subscription socket. It never
 * sends events back to the bridge and never creates wait/ad/financial state.
 */
export class AgentBridgeClient implements vscode.Disposable {
  private socket?: net.Socket;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = INITIAL_RECONNECT_MS;
  private started = false;
  private disposed = false;
  private authenticated = false;
  private buffer = '';
  private connectionState: boolean | undefined;

  private readonly socketPath: string;
  private readonly secretPath: string;
  private readonly reconnect: boolean;

  constructor(private readonly options: AgentBridgeClientOptions) {
    const defaults = getDefaultBridgePaths();
    this.socketPath = options.socketPath ?? defaults.socketPath;
    this.secretPath = options.secretPath ?? defaults.secretPath;
    this.reconnect = options.reconnect ?? true;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.setConnectionState(false);
    void this.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.destroySocket();
  }

  private async connect(): Promise<void> {
    if (this.disposed || !this.started || this.socket) return;
    this.reconnectTimer = undefined;
    let secret: string;
    try {
      secret = (await fs.promises.readFile(this.secretPath, 'utf8')).trim();
      if (secret.length < 32) throw new Error('WaitLayer bridge secret is invalid');
    } catch {
      this.setConnectionState(false);
      this.scheduleReconnect();
      return;
    }
    // Secret-file I/O can outlive logout/deactivation. Re-check lifecycle
    // state before creating a new socket so disposal cannot be undone by an
    // in-flight connection attempt.
    if (this.disposed || !this.started || this.socket) return;

    const socket = net.createConnection(this.socketPath);
    this.socket = socket;
    this.authenticated = false;
    this.buffer = '';
    let settled = false;
    const authTimer = setTimeout(() => {
      if (!settled) socket.destroy(new Error('WaitLayer bridge subscription timed out'));
    }, AUTH_TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ action: 'subscribe', secret })}\n`);
    });
    socket.on('data', (chunk: string) => this.readChunk(chunk));
    socket.on('error', (error) => {
      this.options.onError?.(error);
    });
    socket.on('close', () => {
      settled = true;
      this.setConnectionState(false);
      clearTimeout(authTimer);
      this.socket = undefined;
      this.authenticated = false;
      this.buffer = '';
      if (!this.disposed) this.scheduleReconnect();
    });

    // A successful welcome resets backoff; malformed/rejected messages leave
    // the socket to close and trigger the normal reconnect path.
    const welcome = (chunk: string) => {
      if (chunk.includes('"type":"subscribed"')) {
        this.reconnectDelay = INITIAL_RECONNECT_MS;
        clearTimeout(authTimer);
        socket.off('data', welcome);
      }
    };
    socket.on('data', welcome);
  }

  private readChunk(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_LINE_BYTES) {
      this.socket?.destroy(new Error('WaitLayer bridge message is too large'));
      return;
    }

    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.socket?.destroy(new Error('WaitLayer bridge sent invalid JSON'));
      return;
    }
    if (!isRecord(raw) || (raw.type !== 'subscribed' && raw.type !== 'agent_event')) {
      this.socket?.destroy(new Error('WaitLayer bridge sent an unknown message'));
      return;
    }
    if (raw.type === 'subscribed') {
      if (raw.protocolVersion !== 1) {
        this.socket?.destroy(new Error('WaitLayer bridge protocol version is unsupported'));
        return;
      }
      this.authenticated = true;
      this.reconnectDelay = INITIAL_RECONNECT_MS;
      this.setConnectionState(true);
      return;
    }
    if (!this.authenticated) {
      this.socket?.destroy(new Error('WaitLayer bridge sent an event before authentication'));
      return;
    }
    const parsed = agentLifecycleEventSchema.safeParse(raw.event);
    if (parsed.success) this.options.onEvent(parsed.data);
  }

  private setConnectionState(connected: boolean): void {
    if (this.connectionState === connected) return;
    this.connectionState = connected;
    this.options.onConnectionChange?.(connected);
  }

  private scheduleReconnect(): void {
    if (!this.reconnect || this.disposed || !this.started || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(MAX_RECONNECT_MS, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private destroySocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.destroy();
    this.socket = undefined;
    this.authenticated = false;
    this.buffer = '';
    this.setConnectionState(false);
  }
}

export function getDefaultBridgePaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): { socketPath: string; secretPath: string } {
  const directory =
    process.platform === 'win32' && env.APPDATA
      ? path.join(env.APPDATA, 'WaitLayer')
      : path.join(env.XDG_CONFIG_HOME ?? path.join(homeDirectory, '.config'), 'waitlayer');
  return {
    socketPath:
      process.platform === 'win32'
        ? '\\\\.\\pipe\\waitlayer-bridge-events'
        : path.join(directory, 'bridge-events.sock'),
    secretPath: path.join(directory, 'bridge.secret'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
