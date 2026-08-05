import { beforeEach, describe, expect, it, vi } from 'vitest';

const manager = vi.hoisted(() => ({
  install: vi.fn(),
  repair: vi.fn(),
  setDisabled: vi.fn(),
  uninstall: vi.fn(),
  status: vi.fn(),
}));

vi.mock('../lib/hook-config', () => ({
  HookConfigManager: class {
    install = manager.install;
    repair = manager.repair;
    setDisabled = manager.setDisabled;
    uninstall = manager.uninstall;
    status = manager.status;
  },
}));

import {
  runIntegrationDisable,
  runIntegrationEnable,
  runIntegrationInstall,
  runIntegrationStatus,
  runIntegrationUninstall,
} from './integrations';

const result = {
  provider: 'claude-code',
  status: 'active',
  capability: 'native',
  configPath: '/tmp/settings.json',
  installed: true,
  ownedEntries: 1,
  expectedEvents: ['SessionStart'],
  missingEvents: [],
  backupCount: 0,
  changed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  manager.install.mockImplementation((provider: string) =>
    provider === 'codex'
      ? {
          ...result,
          provider: 'codex',
          status: 'degraded',
          capability: 'degraded',
          reason: 'native support is not verified',
        }
      : result,
  );
  manager.repair.mockReturnValue(result);
  manager.setDisabled.mockImplementation((_provider: string, disabled: boolean) => ({
    ...result,
    status: disabled ? 'disabled' : 'active',
    capability: disabled ? 'disabled' : 'native',
  }));
  manager.uninstall.mockReturnValue({ ...result, status: 'not_installed', capability: 'wrapper' });
  manager.status.mockReturnValue(result);
});

describe('integration commands', () => {
  it('normalizes provider aliases for install, repair, and uninstall', () => {
    expect(runIntegrationInstall({ provider: 'claude_code' })).toEqual(result);
    expect(runIntegrationUninstall({ provider: 'claude' })).toMatchObject({
      status: 'not_installed',
    });
    expect(runIntegrationInstall({ provider: 'codex_cli' })).toMatchObject({
      provider: 'codex',
      capability: 'degraded',
    });
    expect(manager.install).toHaveBeenCalledWith('claude-code');
    expect(manager.repair).not.toHaveBeenCalled();
    expect(manager.uninstall).toHaveBeenCalledWith('claude-code');
  });

  it('reports native and degraded capability states for all known providers without failing aggregate status', () => {
    manager.status.mockImplementation((provider: string) =>
      provider === 'claude-code'
        ? result
        : {
            ...result,
            provider: 'codex',
            status: 'degraded',
            capability: 'degraded',
            reason: 'native support is not verified',
          },
    );
    expect(runIntegrationStatus()).toHaveLength(2);
    expect(manager.status).toHaveBeenNthCalledWith(1, 'claude-code');
    expect(manager.status).toHaveBeenNthCalledWith(2, 'codex');
  });

  it('supports reversible disabled capability state', () => {
    expect(runIntegrationDisable({ provider: 'claude-code' })).toMatchObject({
      status: 'disabled',
      capability: 'disabled',
    });
    expect(runIntegrationEnable({ provider: 'claude-code' })).toMatchObject({
      status: 'active',
      capability: 'native',
    });
    expect(manager.setDisabled).toHaveBeenNthCalledWith(1, 'claude-code', true);
    expect(manager.setDisabled).toHaveBeenNthCalledWith(2, 'claude-code', false);
  });

  it('rejects unsupported providers without touching configuration', () => {
    expect(runIntegrationInstall({ provider: 'unknown-provider' })).toBeNull();
    expect(manager.install).not.toHaveBeenCalled();
  });
});
