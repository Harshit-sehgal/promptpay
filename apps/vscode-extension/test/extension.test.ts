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
    flagFalsePositive: vi.fn(),
    recordAdRendered: vi.fn(),
    updateAdsEnabled: vi.fn(),
    getDeveloperSettings: vi.fn(),
  },
  config: {
    getInactivityTimeoutMs: vi.fn(() => 15_000),
    toggleAds: vi.fn(),
    adsEnabled: vi.fn(),
    inQuietHours: vi.fn(),
    getMaxAdsPerHour: vi.fn(),
    preferredDisplayCurrency: vi.fn(() => ''),
    detectorRolloutPercent: vi.fn(() => 100),
    getDisabledDetectorSources: vi.fn(() => []),
    setDisabledDetectorSources: vi.fn(),
    toggleDetectorSource: vi.fn(),
    falsePositiveSuppressionMinutes: vi.fn(() => 30),
    getDeviceUserId: vi.fn(() => null),
  },
  detector: {
    onSignal: vi.fn(),
    start: vi.fn(),
    triggerManualWait: vi.fn(),
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
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  executeCommand: vi.fn(),
  globalState: { get: vi.fn(() => undefined), update: vi.fn() },
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((name: string, command: () => unknown) => {
      mock.commands.set(name, command);
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn((name: string, ...args: unknown[]) => {
      const handler = mock.commands.get(name);
      const result = handler ? handler(...args) : undefined;
      mock.executeCommand(name, ...args);
      return result;
    }),
  },
  window: {
    showInformationMessage: mock.showInformationMessage,
    showErrorMessage: mock.showErrorMessage,
    showQuickPick: mock.showQuickPick,
  },
  env: { openExternal: vi.fn(), machineId: 'test-machine-id' },
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
  available: { amountMinor: 0n, currency: 'USD' },
  pending: { amountMinor: 0n, currency: 'USD' },
  total: { amountMinor: 0n, currency: 'USD' },
  paidOut: { amountMinor: 0n, currency: 'USD' },
};

function makeContext(): vscode.ExtensionContext {
  return {
    secrets: {},
    subscriptions: [],
    globalState: mock.globalState,
  } as unknown as vscode.ExtensionContext;
}
async function activateAndClearBootState() {
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
  mock.api.flagFalsePositive.mockResolvedValue(undefined);
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
      available: { amountMinor: 950n, currency: 'EUR' },
    });
    await commandPromise;

    expect(mock.status.setEarnings).toHaveBeenCalledWith(950n, 'EUR');
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
      signals: [{ type: 'active_task' }, { type: 'command_execution' }],
    };

    mock.signalHandler?.({
      type: 'wait_start',
      event: { ...event, durationMs: 0, signals: event.signals },
    });
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

describe('extension reportFalseWait command', () => {
  it('does nothing when there is no active wait', async () => {
    await activateAndClearBootState();

    await mock.commands.get('waitlayer.reportFalseWait')?.();

    expect(mock.api.flagFalsePositive).not.toHaveBeenCalled();
    expect(mock.showInformationMessage).toHaveBeenCalledWith('WaitLayer: no active wait to report');
  });

  it('flags the active wait state and then reports already-flagged on repeat', async () => {
    await activateAndClearBootState();
    mock.showQuickPick.mockResolvedValue('Some reason');
    const event = {
      startTime: Date.now(),
      durationMs: 25,
      tool: 'task',
      waitStateId: 'fp-wait-1',
      signals: [{ type: 'active_task' }, { type: 'command_execution' }],
    };
    mock.signalHandler?.({ type: 'wait_start', event });

    await mock.commands.get('waitlayer.reportFalseWait')?.();

    expect(mock.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mock.api.flagFalsePositive).toHaveBeenCalledTimes(1);
    expect(mock.api.flagFalsePositive).toHaveBeenCalledWith('fp-wait-1', 'Some reason');
    expect(mock.showInformationMessage).toHaveBeenCalledWith(
      'WaitLayer: thanks — this wait has been flagged as a false detection',
    );

    await mock.commands.get('waitlayer.reportFalseWait')?.();

    expect(mock.api.flagFalsePositive).toHaveBeenCalledTimes(1);
    expect(mock.showInformationMessage).toHaveBeenCalledWith(
      'WaitLayer: this wait has already been reported as a false detection',
    );
  });

  it('clears the flagged state when a new wait starts', async () => {
    await activateAndClearBootState();
    mock.showQuickPick.mockResolvedValue('Some reason');
    mock.signalHandler?.({
      type: 'wait_start',
      event: {
        startTime: Date.now(),
        durationMs: 25,
        tool: 'task',
        waitStateId: 'fp-a',
        signals: [{ type: 'active_task' }, { type: 'command_execution' }],
      },
    });
    await mock.commands.get('waitlayer.reportFalseWait')?.();
    expect(mock.api.flagFalsePositive).toHaveBeenCalledTimes(1);
    expect(mock.api.flagFalsePositive).toHaveBeenCalledWith('fp-a', 'Some reason');

    mock.api.flagFalsePositive.mockClear();
    mock.signalHandler?.({
      type: 'wait_start',
      event: {
        startTime: Date.now(),
        durationMs: 25,
        tool: 'task',
        waitStateId: 'fp-b',
        signals: [{ type: 'active_task' }, { type: 'command_execution' }],
      },
    });
    await mock.commands.get('waitlayer.reportFalseWait')?.();

    expect(mock.api.flagFalsePositive).toHaveBeenCalledTimes(1);
    expect(mock.api.flagFalsePositive).toHaveBeenCalledWith('fp-b', 'Some reason');
  });

  it('forwards a normalized reason code to flagFalsePositive (P1 #16)', async () => {
    await activateAndClearBootState();
    const event = {
      startTime: Date.now(),
      durationMs: 25,
      tool: 'task',
      waitStateId: 'fp-reason',
      signals: [{ type: 'active_task' }, { type: 'command_execution' }],
    };
    mock.signalHandler?.({ type: 'wait_start', event });

    await mock.commands.get('waitlayer.reportFalseWait')?.('no_ai_generation');

    expect(mock.api.flagFalsePositive).toHaveBeenCalledTimes(1);
    expect(mock.api.flagFalsePositive).toHaveBeenCalledWith('fp-reason', 'no_ai_generation');
  });

  it('degrades an unknown programmatic reason to the normalized other code', async () => {
    await activateAndClearBootState();
    const event = {
      startTime: Date.now(),
      durationMs: 25,
      tool: 'task',
      waitStateId: 'fp-reason-unknown',
      signals: [{ type: 'active_task' }, { type: 'command_execution' }],
    };
    mock.signalHandler?.({ type: 'wait_start', event });

    await mock.commands.get('waitlayer.reportFalseWait')?.('Just reading docs, not AI');

    expect(mock.api.flagFalsePositive).toHaveBeenCalledWith('fp-reason-unknown', 'other');
  });
});

describe('extension showEarnings command — per-currency breakdown (P1.4)', () => {
  it('renders a per-currency breakdown using the derived primary currency', async () => {
    await activateAndClearBootState();
    mock.api.getBalance.mockResolvedValue({
      available: {
        amountMinor: 1000n,
        currency: 'JPY',
        byCurrency: { JPY: '1000', USD: '9999' },
      },
      pending: {
        amountMinor: 0n,
        currency: 'JPY',
        byCurrency: { JPY: '0', USD: '500' },
      },
      total: {
        amountMinor: 1000n,
        currency: 'JPY',
        byCurrency: { JPY: '1000', USD: '9999' },
      },
      paidOut: {
        amountMinor: 0n,
        currency: 'JPY',
        byCurrency: { JPY: '0', USD: '0' },
      },
    });

    await mock.commands.get('waitlayer.showEarnings')?.();

    const callArg = mock.showInformationMessage.mock.calls
      .map((c) => c[0])
      .find((m): m is string => typeof m === 'string' && m.includes('Per-currency breakdown'));
    expect(callArg).toBeDefined();
    // JPY is the primary (first positive in ISO order); USD has the larger
    // raw minor value but must NOT be selected/formatted as the headline.
    expect(callArg).toContain('JPY: ¥1,000');
    expect(callArg).toContain('USD: $99.99');
    expect(callArg).not.toContain('$99.99 available');
  });
});

describe('extension detector controls (P1.17)', () => {
  it('toggleDetectorSource toggles the source and reports the new state', async () => {
    await activateAndClearBootState();
    mock.config.toggleDetectorSource.mockResolvedValue(['inactivity']);
    await mock.commands.get('waitlayer.toggleDetectorSource')?.('inactivity');
    expect(mock.config.toggleDetectorSource).toHaveBeenCalledWith('inactivity');
    expect(mock.showInformationMessage).toHaveBeenCalledWith(
      "WaitLayer: detector source 'inactivity' is now disabled",
    );
  });

  it('showExperimentAssignment reports enrollment at default rollout', async () => {
    await activateAndClearBootState();
    mock.config.detectorRolloutPercent.mockReturnValue(100);
    await mock.commands.get('waitlayer.showExperimentAssignment')?.();
    const msg = mock.showInformationMessage.mock.calls
      .map((c) => c[0])
      .find((m): m is string => typeof m === 'string' && m.includes('detector experiment'));
    expect(msg).toBeDefined();
    expect(msg).toContain('Enrolled');
    expect(msg).toContain('bucket');
  });
});

describe('extension triggerManualWait command (P1 #12)', () => {
  it('registers the manifest-advertised command and reports a shadow-only manual wait', async () => {
    await activateAndClearBootState();
    expect(mock.commands.has('waitlayer.triggerManualWait')).toBe(true);

    mock.detector.triggerManualWait.mockReturnValue('ws-manual-1');
    mock.showQuickPick.mockResolvedValue('codex');
    await mock.commands.get('waitlayer.triggerManualWait')?.();

    expect(mock.showQuickPick).toHaveBeenCalled();
    expect(mock.detector.triggerManualWait).toHaveBeenCalledWith('codex');
    const msg = mock.showInformationMessage.mock.calls
      .map((c) => c[0])
      .find((m): m is string => typeof m === 'string' && m.includes('manual wait reported'));
    expect(msg).toBeDefined();
    expect(msg).toContain('shadow-only');
    expect(msg).toContain('never billable');
  });

  it('reports when the detector refuses to start (source disabled or suppressed)', async () => {
    await activateAndClearBootState();
    mock.detector.triggerManualWait.mockReturnValue('');

    // Pass the tool directly — skips the quick-pick.
    await (mock.commands.get('waitlayer.triggerManualWait') as (t?: string) => Promise<void>)(
      'claude',
    );

    expect(mock.detector.triggerManualWait).toHaveBeenCalledWith('claude');
    const msg = mock.showInformationMessage.mock.calls
      .map((c) => c[0])
      .find((m): m is string => typeof m === 'string' && m.includes('manual wait not started'));
    expect(msg).toBeDefined();
  });
});

describe('extension reportFalseWait — reason + suppression (P1.18)', () => {
  it('prompts for a reason when none is supplied and suppresses new waits', async () => {
    await activateAndClearBootState();
    mock.showQuickPick.mockResolvedValue('I was actively working, not waiting on AI');
    mock.signalHandler?.({
      type: 'wait_start',
      event: {
        startTime: Date.now(),
        durationMs: 25,
        tool: 'task',
        waitStateId: 'fp-pick',
        signals: [{ type: 'active_task' }, { type: 'command_execution' }],
      },
    });
    await mock.commands.get('waitlayer.reportFalseWait')?.();
    expect(mock.showQuickPick).toHaveBeenCalled();
    expect(mock.api.flagFalsePositive).toHaveBeenCalledWith(
      'fp-pick',
      'I was actively working, not waiting on AI',
    );
    // Suppression window recorded in globalState (a future numeric timestamp).
    const suppressCall = mock.globalState.update.mock.calls.find(
      (c) => typeof c[1] === 'number' && (c[1] as number) > Date.now(),
    );
    expect(suppressCall).toBeTruthy();
  });

  it('shows an in-wait notification that offers to report a false positive', async () => {
    await activateAndClearBootState();
    // The richer notification returns the "Report false positive" action.
    mock.showInformationMessage.mockResolvedValue({ title: 'Report false positive' });
    mock.showQuickPick.mockResolvedValue('I was actively working, not waiting on AI');
    mock.signalHandler?.({
      type: 'wait_start',
      event: {
        startTime: Date.now(),
        durationMs: 25,
        tool: 'task',
        waitStateId: 'notify-wait',
        signals: [{ type: 'active_task' }, { type: 'command_execution' }],
      },
    });
    await vi.waitFor(() =>
      expect(mock.executeCommand).toHaveBeenCalledWith('waitlayer.reportFalseWait'),
    );
    // And the triggered report flow flags the active wait with the chosen reason.
    await vi.waitFor(() =>
      expect(mock.api.flagFalsePositive).toHaveBeenCalledWith(
        'notify-wait',
        'I was actively working, not waiting on AI',
      ),
    );
  });
});
