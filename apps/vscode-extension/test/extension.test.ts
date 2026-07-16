import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mock = vi.hoisted(() => ({
  commands: new Map<string, () => unknown>(),
  api: {
    promptLogin: vi.fn(),
    logout: vi.fn(),
    getBalance: vi.fn(),
    getOrRegisterDevice: vi.fn(),
    waitStateStart: vi.fn(),
    waitStateEnd: vi.fn(),
    requestAd: vi.fn(),
  },
  config: {
    getInactivityTimeoutMs: vi.fn(() => 15_000),
    toggleAds: vi.fn(),
    adsEnabled: vi.fn(),
    inQuietHours: vi.fn(),
    getMaxAdsPerHour: vi.fn(),
  },
  detector: {
    onSignal: vi.fn(),
    start: vi.fn(),
  },
  signalHandler: undefined as
    | ((signal: {
        type: 'wait_start' | 'wait_end';
        event: { startTime: number; durationMs: number; tool: string; waitStateId: string };
      }) => void)
    | undefined,
  panel: {
    show: vi.fn(),
    hide: vi.fn(),
  },
  status: {
    register: vi.fn(),
    setLoggedIn: vi.fn(),
    setLoggedOut: vi.fn(),
    setEarnings: vi.fn(),
    showAdServing: vi.fn(),
    showIdle: vi.fn(),
  },
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((name: string, command: () => unknown) => {
      mock.commands.set(name, command);
      return { dispose: vi.fn() };
    }),
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  env: { openExternal: vi.fn() },
  Uri: { parse: vi.fn((value: string) => value) },
}));

vi.mock('../src/api-client', () => ({
  ApiClient: vi.fn(function ApiClient() {
    return mock.api;
  }),
}));

vi.mock('../src/config', () => ({
  ConfigurationManager: vi.fn(function ConfigurationManager() {
    return mock.config;
  }),
}));

vi.mock('../src/wait-detector', () => ({
  WaitStateDetector: vi.fn(function WaitStateDetector() {
    return mock.detector;
  }),
}));

vi.mock('../src/ad-panel', () => ({
  AdPanel: vi.fn(function AdPanel() {
    return mock.panel;
  }),
}));

vi.mock('../src/status-bar', () => ({
  StatusBar: vi.fn(function StatusBar() {
    return mock.status;
  }),
}));

import { activate } from '../src/extension';

const zeroBalance = {
  available: { amountMinor: 0, currency: 'USD' },
  pending: { amountMinor: 0, currency: 'USD' },
  total: { amountMinor: 0, currency: 'USD' },
  paidOut: { amountMinor: 0, currency: 'USD' },
};

function makeContext(): vscode.ExtensionContext {
  return { secrets: {}, subscriptions: [] } as unknown as vscode.ExtensionContext;
}

async function activateAndClearBootState() {
  mock.api.getBalance.mockResolvedValue(zeroBalance);
  activate(makeContext());
  await vi.waitFor(() => expect(mock.status.setEarnings).toHaveBeenCalled());
  mock.api.getBalance.mockClear();
  mock.status.setEarnings.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.commands.clear();
  mock.api.promptLogin.mockResolvedValue(false);
  mock.api.logout.mockResolvedValue(undefined);
  mock.api.getBalance.mockResolvedValue(zeroBalance);
  mock.api.getOrRegisterDevice.mockResolvedValue('device-1');
  mock.api.waitStateStart.mockResolvedValue({});
  mock.api.waitStateEnd.mockResolvedValue({});
  mock.api.requestAd.mockResolvedValue(null);
  mock.config.adsEnabled.mockResolvedValue(false);
  mock.config.inQuietHours.mockResolvedValue(false);
  mock.config.getMaxAdsPerHour.mockResolvedValue(5);
  mock.signalHandler = undefined;
  mock.detector.onSignal.mockImplementation((handler) => {
    mock.signalHandler = handler;
  });
});

describe('extension auth commands', () => {
  it('switches to logged-in state before the post-login balance request finishes', async () => {
    await activateAndClearBootState();
    const balance = Promise.withResolvers<typeof zeroBalance>();
    mock.api.promptLogin.mockResolvedValue(true);
    mock.api.getBalance.mockReturnValue(balance.promise);

    const commandPromise = Promise.resolve(mock.commands.get('waitlayer.login')?.());
    await vi.waitFor(() => expect(mock.status.setLoggedIn).toHaveBeenCalledTimes(1));

    expect(mock.status.setEarnings).not.toHaveBeenCalled();
    balance.resolve({
      ...zeroBalance,
      available: { amountMinor: 950, currency: 'EUR' },
    });
    await commandPromise;

    expect(mock.status.setEarnings).toHaveBeenCalledWith(950, 'EUR');
  });

  it('switches the status bar to logged out when logout completes', async () => {
    await activateAndClearBootState();

    await mock.commands.get('waitlayer.logout')?.();

    expect(mock.api.logout).toHaveBeenCalledTimes(1);
    expect(mock.status.setLoggedOut).toHaveBeenCalledTimes(1);
  });
});

describe('extension wait lifecycle', () => {
  it('records a short wait end only after its matching start and skips post-end ad work', async () => {
    await activateAndClearBootState();
    const startGate = Promise.withResolvers<void>();
    mock.api.waitStateStart.mockImplementationOnce(async () => startGate.promise);
    const event = {
      startTime: Date.now(),
      durationMs: 25,
      tool: 'task',
      waitStateId: 'short-task-wait',
    };

    mock.signalHandler?.({ type: 'wait_start', event: { ...event, durationMs: 0 } });
    await vi.waitFor(() => expect(mock.api.waitStateStart).toHaveBeenCalledTimes(1));

    mock.signalHandler?.({ type: 'wait_end', event });
    await Promise.resolve();
    expect(mock.api.waitStateEnd).not.toHaveBeenCalled();

    startGate.resolve();
    await vi.waitFor(() => expect(mock.api.waitStateEnd).toHaveBeenCalledTimes(1));
    expect(mock.api.waitStateEnd).toHaveBeenCalledWith(
      expect.objectContaining({ waitStateId: event.waitStateId, durationSeconds: 0 }),
    );
    expect(mock.api.waitStateStart.mock.invocationCallOrder[0]).toBeLessThan(
      mock.api.waitStateEnd.mock.invocationCallOrder[0],
    );
    expect(mock.api.requestAd).not.toHaveBeenCalled();
  });
});
