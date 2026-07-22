import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSupervisedCommand } from './run';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const child = {
    kill: vi.fn(),
    once(event: string, callback: (...args: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), callback]);
      return child;
    },
    emit(event: string, ...args: any[]) {
      const callbacks = listeners.get(event) ?? [];
      listeners.delete(event);
      for (const callback of callbacks) callback(...args);
    },
    removeAllListeners() {
      listeners.clear();
      return child;
    },
  };
  return {
    child,
    spawn: vi.fn(() => child),
    api: {
      getOrRegisterDevice: vi.fn().mockResolvedValue('device-1'),
      reportWaitState: vi.fn().mockResolvedValue(undefined),
      endWaitState: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../lib/credentials', () => ({
  getCredentials: vi.fn().mockResolvedValue({ email: 'dev@example.test' }),
}));
vi.mock('../lib/api-client', () => ({
  ApiClient: class {
    getOrRegisterDevice = mocks.api.getOrRegisterDevice;
    reportWaitState = mocks.api.reportWaitState;
    endWaitState = mocks.api.endWaitState;
  },
}));

describe('runSupervisedCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.spawn.mockClear();
    mocks.api.getOrRegisterDevice.mockClear();
    mocks.api.reportWaitState.mockClear();
    mocks.api.endWaitState.mockClear();
    mocks.child.removeAllListeners();
  });

  it('records a directly supervised local process lifecycle without marking it billable', async () => {
    const run = runSupervisedCommand(['claude', '--version']);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    mocks.child.emit('spawn');
    await vi.waitFor(() => expect(mocks.api.reportWaitState).toHaveBeenCalledOnce());
    mocks.child.emit('close', 0, null);

    await expect(run).resolves.toBe(0);
    expect(mocks.spawn).toHaveBeenCalledWith('claude', ['--version'], {
      stdio: 'inherit',
      shell: false,
    });
    expect(mocks.api.reportWaitState).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        toolType: 'claude_code',
        waitStateId: expect.stringMatching(/^cli-run-/),
        evidence: [
          expect.objectContaining({
            type: 'command_execution',
            adapterId: 'cli.runner.supervisor',
            sourceType: 'inferred',
          }),
          expect.objectContaining({
            type: 'active_task',
            adapterId: 'cli.runner.child_process',
            sourceType: 'inferred',
          }),
        ],
      }),
    );
    expect(mocks.api.endWaitState).toHaveBeenCalledWith(
      expect.objectContaining({ waitStateId: expect.stringMatching(/^cli-run-/) }),
    );
  });

  it('still runs the wrapped command when start telemetry is unavailable', async () => {
    mocks.api.reportWaitState.mockRejectedValueOnce(new Error('offline'));
    const run = runSupervisedCommand(['codex', 'exec']);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    mocks.child.emit('spawn');
    await vi.waitFor(() => expect(mocks.api.reportWaitState).toHaveBeenCalledOnce());
    mocks.child.emit('close', 7, null);

    await expect(run).resolves.toBe(7);
    expect(mocks.api.endWaitState).not.toHaveBeenCalled();
  });

  it('does not record telemetry when the wrapped executable cannot spawn', async () => {
    const run = runSupervisedCommand(['missing-ai-cli']);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    mocks.child.emit('error', new Error('ENOENT'));

    await expect(run).rejects.toThrow('ENOENT');
    expect(mocks.api.reportWaitState).not.toHaveBeenCalled();
    expect(mocks.api.endWaitState).not.toHaveBeenCalled();
  });

  it('requires a command', async () => {
    await expect(runSupervisedCommand([])).rejects.toThrow('Usage: waitlayer run');
  });
});
