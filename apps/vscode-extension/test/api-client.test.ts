import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

/**
 * Captured transport state. `vi.mock` factories are hoisted above imports, so
 * the shared state lives in `vi.hoisted`. The mocked http/https `request`
 * implementations push the resolved request options here and replay a fake
 * 200 response (no real sockets), so URL resolution and header shaping can be
 * asserted without a network.
 */
const mock = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  secrets: {} as Record<string, string>,
  captured: [] as Array<Record<string, unknown>>,
  used: '' as string,
  nextBody: '{}',
  nextStatus: 200,
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: (key: string, def?: unknown) =>
        mock.config[key] !== undefined ? mock.config[key] : def,
      update: vi.fn(async (key: string, value: unknown) => {
        mock.config[key] = value;
      }),
      has: vi.fn(() => true),
    })),
  },
  env: { machineId: 'test-machine-id' },
  window: {
    showInputBox: vi.fn(() => Promise.resolve(undefined)),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

function fakeRequest(
  protocol: 'http' | 'https',
): (options: Record<string, unknown>, callback: (res: unknown) => void) => unknown {
  return (options, callback) => {
    mock.used = protocol;
    mock.captured.push(options);

    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const res = {
      statusCode: mock.nextStatus,
      on(event: string, cb: (...args: unknown[]) => void) {
        (handlers[event] ||= []).push(cb);
        return res;
      },
    };

    // Attach listeners first (inside the real callback), then stream the body.
    callback(res);
    queueMicrotask(() => {
      (handlers['data'] || []).forEach((h) => h(mock.nextBody));
      (handlers['end'] || []).forEach((h) => h());
    });

    return {
      setTimeout: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };
  };
}

vi.mock('http', () => ({ request: vi.fn(fakeRequest('http')) }));
vi.mock('https', () => ({ request: vi.fn(fakeRequest('https')) }));

import { ApiClient } from '../src/api-client';
import { ConfigurationManager } from '../src/config';

function makeSecrets(): vscode.SecretStorage {
  return {
    get: vi.fn(async (key: string) => mock.secrets[key] ?? null),
    store: vi.fn(async (key: string, value: string) => {
      mock.secrets[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      delete mock.secrets[key];
    }),
  } as unknown as vscode.SecretStorage;
}

function makeClient(): ApiClient {
  return new ApiClient(new ConfigurationManager(makeSecrets()));
}

beforeEach(() => {
  mock.config = {};
  mock.secrets = {};
  mock.captured = [];
  mock.used = '';
  mock.nextBody = '{}';
  mock.nextStatus = 200;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiClient — URL / base-URL resolution', () => {
  it('resolves GET requests against the configured base URL', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    const client = makeClient();

    await client.getBalance();
    const opts = mock.captured[0] as Record<string, unknown>;

    expect(opts.hostname).toBe('api.example.com');
    expect(opts.port).toBe(443); // https default port when unspecified
    expect(opts.path).toBe('/api/v1/ledger/balance');
    expect(opts.method).toBe('GET');
  });

  it('falls back to the SaaS default origin when no apiUrl is set', async () => {
    const client = makeClient();

    await client.getBalance();
    const opts = mock.captured[0] as Record<string, unknown>;

    expect(opts.hostname).toBe('api.waitlayer.com');
    expect(opts.path).toBe('/api/v1/ledger/balance');
  });

  it('uses the loopback http transport and preserves an explicit port', async () => {
    mock.config['apiUrl'] = 'http://localhost:4002/api/v1';
    const client = makeClient();

    await client.getBalance();
    const opts = mock.captured[0] as Record<string, unknown>;

    expect(mock.used).toBe('http');
    expect(opts.hostname).toBe('localhost');
    expect(opts.port).toBe('4002');
    expect(opts.path).toBe('/api/v1/ledger/balance');
  });
});

describe('ApiClient — header shaping', () => {
  it('adds extension/tool identification headers to every request', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    const client = makeClient();

    await client.getBalance();
    const opts = mock.captured[0] as { headers: Record<string, string> };

    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Extension-Version']).toBe('0.0.1');
    expect(opts.headers['X-Tool-Type']).toBe('vscode');
  });

  it('attaches a Bearer Authorization header once access tokens are loaded', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'tok-123',
      refreshToken: 'rt-456',
    });
    const client = makeClient();

    await client.getBalance();
    const opts = mock.captured[0] as { headers: Record<string, string> };

    expect(opts.headers['Authorization']).toBe('Bearer tok-123');
  });

  it('shapes signed POST headers (Content-Length + auth) and posts to the event endpoint', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'tok-123',
      refreshToken: 'rt-456',
    });
    mock.secrets['waitlayer.deviceEventSecret'] = 'dev-secret';
    const client = makeClient();

    await client.waitStateStart({
      deviceId: 'd1',
      sessionId: 's1',
      waitStateId: 'w1',
      toolType: 'vscode',
      idempotencyKey: 'i1',
    });
    const opts = mock.captured[0] as {
      method: string;
      path: string;
      headers: Record<string, string>;
    };

    expect(opts.method).toBe('POST');
    expect(opts.path).toBe('/api/v1/extension/wait-state/start');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Content-Length']).toMatch(/^\d+$/);
    expect(opts.headers['Authorization']).toBe('Bearer tok-123');
    expect(opts.headers['X-Extension-Version']).toBe('0.0.1');
    expect(opts.headers['X-Tool-Type']).toBe('vscode');
  });
});
