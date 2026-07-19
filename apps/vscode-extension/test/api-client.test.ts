import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  bodies: [] as string[],
  deleted: [] as string[],
  inputs: [] as Array<string | undefined>,
  responses: [] as Array<{ status: number; body: string }>,
  storeHook: undefined as ((key: string, value: string) => Promise<void>) | undefined,
  deleteHook: undefined as ((key: string) => Promise<void>) | undefined,
  used: '' as string,
  nextBody: JSON.stringify({
    available: { amountMinor: '0', currency: 'USD' },
    pending: { amountMinor: '0', currency: 'USD' },
    total: { amountMinor: '0', currency: 'USD' },
    paidOut: { amountMinor: '0', currency: 'USD' },
  }),
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
    showInputBox: vi.fn(() => Promise.resolve(mock.inputs.shift())),
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
    const response = mock.responses.shift() ?? {
      status: mock.nextStatus,
      body: mock.nextBody,
    };

    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const res = {
      statusCode: response.status,
      on(event: string, cb: (...args: unknown[]) => void) {
        (handlers[event] ||= []).push(cb);
        return res;
      },
    };

    // Attach listeners first (inside the real callback), then stream the body.
    callback(res);
    queueMicrotask(() => {
      (handlers['data'] || []).forEach((h) => h(response.body));
      (handlers['end'] || []).forEach((h) => h());
    });

    return {
      setTimeout: vi.fn(),
      on: vi.fn(),
      write: (b: string) => {
        mock.bodies.push(b);
      },
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
      await mock.storeHook?.(key, value);
      mock.secrets[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      mock.deleted.push(key);
      await mock.deleteHook?.(key);
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
  mock.bodies = [];
  mock.inputs = [];
  mock.responses = [];
  mock.storeHook = undefined;
  mock.deleteHook = undefined;
  mock.used = '';
  mock.nextBody = JSON.stringify({
    available: { amountMinor: '0', currency: 'USD' },
    pending: { amountMinor: '0', currency: 'USD' },
    total: { amountMinor: '0', currency: 'USD' },
    paidOut: { amountMinor: '0', currency: 'USD' },
  });
  mock.nextStatus = 200;
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

describe('ApiClient — auth state ordering', () => {
  it('persists a rotated refresh token before retrying the original request', async () => {
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    });
    mock.responses = [
      { status: 401, body: JSON.stringify({ message: 'expired' }) },
      {
        status: 200,
        body: JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      },
      {
        status: 200,
        body: JSON.stringify({
          available: { amountMinor: '1250', currency: 'USD' },
          pending: { amountMinor: '0', currency: 'USD' },
          total: { amountMinor: '1250', currency: 'USD' },
          paidOut: { amountMinor: '0', currency: 'USD' },
        }),
      },
    ];
    const gate = Promise.withResolvers<void>();
    let tokenStoreStarted = false;
    mock.storeHook = async (key) => {
      if (key !== 'waitlayer.authTokens') return;
      tokenStoreStarted = true;
      await gate.promise;
    };
    const client = makeClient();

    const balancePromise = client.getBalance();
    const settled = vi.fn();
    void balancePromise.then(settled);
    await vi.waitFor(() => expect(tokenStoreStarted).toBe(true));

    expect(settled).not.toHaveBeenCalled();
    expect(mock.captured).toHaveLength(2);
    expect(JSON.parse(mock.secrets['waitlayer.authTokens'])).toEqual({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    });

    gate.resolve();
    await expect(balancePromise).resolves.toMatchObject({
      available: { amountMinor: 1250n, currency: 'USD' },
    });
    expect(mock.captured).toHaveLength(3);
    expect(JSON.parse(mock.secrets['waitlayer.authTokens'])).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    const retry = mock.captured[2] as { headers: Record<string, string> };
    expect(retry.headers['Authorization']).toBe('Bearer new-access');
  });

  it('does not retry with rotated tokens when SecretStorage persistence fails', async () => {
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    });
    mock.responses = [
      { status: 401, body: JSON.stringify({ message: 'expired' }) },
      {
        status: 200,
        body: JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      },
    ];
    mock.storeHook = async (key) => {
      if (key === 'waitlayer.authTokens') throw new Error('secret store unavailable');
    };
    const client = makeClient();

    await expect(client.getBalance()).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.captured).toHaveLength(2);
    expect(mock.secrets['waitlayer.authTokens']).toBeUndefined();
  });

  it('does not report login success when token persistence fails', async () => {
    mock.inputs = ['dev@example.com', 'password'];
    mock.responses = [
      {
        status: 200,
        body: JSON.stringify({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          user: { id: 'new-user' },
        }),
      },
    ];
    mock.storeHook = async (key) => {
      if (key === 'waitlayer.authTokens') throw new Error('secret store unavailable');
    };
    const client = makeClient();

    await expect(client.promptLogin()).resolves.toBe(false);
    expect(mock.secrets['waitlayer.authTokens']).toBeUndefined();
  });

  it('awaits different-user device cleanup before completing login', async () => {
    mock.secrets['waitlayer.deviceUUID'] = 'old-device';
    mock.secrets['waitlayer.deviceEventSecret'] = 'old-secret';
    mock.secrets['waitlayer.deviceUserId'] = 'old-user';
    mock.inputs = ['new@example.com', 'password'];
    mock.responses = [
      {
        status: 200,
        body: JSON.stringify({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          user: { id: 'new-user' },
        }),
      },
    ];
    const gate = Promise.withResolvers<void>();
    let cleanupStarted = false;
    mock.deleteHook = async (key) => {
      if (key !== 'waitlayer.deviceUUID') return;
      cleanupStarted = true;
      await gate.promise;
    };
    const client = makeClient();

    const loginPromise = client.promptLogin();
    const settled = vi.fn();
    void loginPromise.then(settled);
    await vi.waitFor(() => expect(cleanupStarted).toBe(true));

    expect(settled).not.toHaveBeenCalled();
    expect(mock.secrets['waitlayer.deviceUUID']).toBe('old-device');
    expect(mock.secrets['waitlayer.authTokens']).toBeUndefined();

    gate.resolve();
    await expect(loginPromise).resolves.toBe(true);
    expect(mock.secrets['waitlayer.deviceUUID']).toBeUndefined();
    expect(mock.secrets['waitlayer.deviceEventSecret']).toBeUndefined();
    expect(mock.secrets['waitlayer.deviceUserId']).toBeUndefined();
    expect(JSON.parse(mock.secrets['waitlayer.authTokens'])).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('does not complete logout until persisted tokens are cleared', async () => {
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    mock.responses = [{ status: 200, body: '{}' }];
    const gate = Promise.withResolvers<void>();
    let clearStarted = false;
    mock.deleteHook = async (key) => {
      if (key !== 'waitlayer.authTokens') return;
      clearStarted = true;
      await gate.promise;
    };
    const client = makeClient();

    const logoutPromise = client.logout();
    const settled = vi.fn();
    void logoutPromise.then(settled);
    await vi.waitFor(() => expect(clearStarted).toBe(true));

    expect(settled).not.toHaveBeenCalled();
    expect(mock.secrets['waitlayer.authTokens']).toBeDefined();

    gate.resolve();
    await logoutPromise;
    expect(mock.secrets['waitlayer.authTokens']).toBeUndefined();
  });

  it('propagates logout failure when persisted tokens cannot be cleared', async () => {
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    mock.responses = [{ status: 200, body: '{}' }];
    mock.deleteHook = async (key) => {
      if (key === 'waitlayer.authTokens') throw new Error('secret delete unavailable');
    };
    const client = makeClient();

    await expect(client.logout()).rejects.toThrow('secret delete unavailable');
    expect(mock.secrets['waitlayer.authTokens']).toBeDefined();
  });
});

describe('ApiClient — flagFalsePositive', () => {
  it('POSTs to the false-positive endpoint for the given wait state with auth', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'tok-123',
      refreshToken: 'rt-456',
    });
    const client = makeClient();

    await client.flagFalsePositive('wz-9');

    const opts = mock.captured[0] as {
      method: string;
      path: string;
      headers: Record<string, string>;
    };
    expect(opts.method).toBe('POST');
    expect(opts.path).toBe('/api/v1/extension/wait-state/wz-9/false-positive');
    expect(opts.headers['Authorization']).toBe('Bearer tok-123');
    expect(opts.headers['X-Extension-Version']).toBe('0.0.1');
    expect(opts.headers['X-Tool-Type']).toBe('vscode');
  });

  it('includes the optional reason in the payload when provided', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'tok-123',
      refreshToken: 'rt-456',
    });
    const client = makeClient();

    await client.flagFalsePositive('wz-9', 'false alarm — reading docs');

    expect(mock.bodies).toHaveLength(1);
    expect(JSON.parse(mock.bodies[0])).toMatchObject({ reason: 'false alarm — reading docs' });
  });

  it('omits reason from the payload when not provided (backward compatible)', async () => {
    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    mock.secrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: 'tok-123',
      refreshToken: 'rt-456',
    });
    const client = makeClient();

    await client.flagFalsePositive('wz-9');

    expect(mock.bodies).toHaveLength(1);
    expect(JSON.parse(mock.bodies[0])).not.toHaveProperty('reason');
  });
});
