import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ATEVA_HOOK_MARKER, HookConfigManager } from './hook-config';

const temporaryDirectories: string[] = [];

function makeManager(
  initial: Record<string, unknown> | string | undefined,
  provider: 'claude-code' | 'codex' = 'claude-code',
) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ateva-hooks-'));
  temporaryDirectories.push(home);
  const configPath = path.join(
    home,
    provider === 'claude-code' ? '.claude/settings.json' : '.codex/config.json',
  );
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (initial !== undefined) {
    fs.writeFileSync(
      configPath,
      typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`,
    );
  }
  return {
    manager: new HookConfigManager({
      homeDir: home,
      stateDir: path.join(home, '.config', 'ateva'),
      configPaths: { [provider]: configPath },
      executable: '/opt/ateva',
      now: () => new Date('2026-08-04T12:00:00.000Z'),
    }),
    configPath,
    home,
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('HookConfigManager', () => {
  it('creates a user-level config and owns all expected Claude hook entries', () => {
    const { manager, configPath } = makeManager(undefined);
    const result = manager.install('claude-code');

    expect(result.status).toBe('active');
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(Object.keys(saved.hooks)).toHaveLength(result.expectedEvents.length);
    expect(JSON.stringify(saved)).toContain(ATEVA_HOOK_MARKER);
    expect(JSON.stringify(saved)).not.toContain('prompt');
  });

  it('merges without replacing unrelated provider hooks and creates a protected backup', () => {
    const existing = {
      permissions: { allow: ['Bash'] },
      hooks: {
        SessionStart: [
          { matcher: 'custom', hooks: [{ type: 'command', command: 'custom-start' }] },
        ],
      },
    };
    const { manager, configPath } = makeManager(existing);
    const result = manager.install('claude-code');

    expect(result.status).toBe('active');
    expect(result.backupPath).toBeTruthy();
    expect(fs.existsSync(result.backupPath as string)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as typeof existing;
    expect(saved.permissions).toEqual(existing.permissions);
    expect(saved.hooks.SessionStart[0].hooks[0].command).toBe('custom-start');
    expect(JSON.stringify(saved)).toContain(ATEVA_HOOK_MARKER);
    expect(fs.statSync(result.backupPath as string).mode & 0o777).toBe(0o600);
  });

  it('is idempotent and repair restores a removed owned entry without touching custom hooks', () => {
    const { manager, configPath } = makeManager({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'custom' }] }] },
    });
    const first = manager.install('claude-code');
    const second = manager.install('claude-code');
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    config.hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'custom' }] }];
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    expect(manager.status('claude-code').status).toBe('degraded');
    expect(manager.repair('claude-code').status).toBe('active');
    expect(JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf8')))).toContain('custom');
  });

  it('uninstalls only Ateva-owned commands and leaves custom hooks', () => {
    const { manager, configPath } = makeManager(undefined);
    manager.install('claude-code');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      hooks: { SessionStart: Array<{ hooks: Array<Record<string, string>> }> };
    };
    config.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'custom-after' });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = manager.uninstall('claude-code');
    expect(result.status).toBe('not_installed');
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      hooks: { SessionStart: unknown[] };
    };
    expect(JSON.stringify(saved)).not.toContain(ATEVA_HOOK_MARKER);
    expect(JSON.stringify(saved)).toContain('custom-after');
  });

  it('refuses unsupported event shapes instead of overwriting them', () => {
    const { manager, configPath } = makeManager({ hooks: { SessionStart: { unexpected: true } } });
    const result = manager.install('claude-code');
    expect(result.status).toBe('degraded');
    expect(fs.readFileSync(configPath, 'utf8')).toContain('unexpected');
  });

  it('reports malformed and managed configurations as degraded instead of overwriting them', () => {
    const malformed = makeManager('{not-json');
    expect(malformed.manager.install('claude-code')).toMatchObject({
      status: 'degraded',
      changed: false,
    });
    expect(fs.readFileSync(malformed.configPath, 'utf8')).toBe('{not-json');

    const managed = makeManager({ managedBy: 'enterprise', hooks: {} });
    const result = managed.manager.install('claude-code');
    expect(result.status).toBe('managed');
    expect(result.reason).toContain('managed');
    expect(JSON.parse(fs.readFileSync(managed.configPath, 'utf8'))).toEqual({
      managedBy: 'enterprise',
      hooks: {},
    });
  });

  it('persists disabled state and restores the native capability across manager instances', () => {
    const first = makeManager(undefined);
    expect(first.manager.install('claude-code').status).toBe('active');
    expect(first.manager.setDisabled('claude-code', true)).toMatchObject({
      status: 'disabled',
      capability: 'disabled',
    });

    const second = new HookConfigManager({
      homeDir: first.home,
      stateDir: path.join(first.home, '.config', 'ateva'),
      configPaths: { 'claude-code': first.configPath },
      executable: '/opt/ateva',
      now: () => new Date('2026-08-04T12:00:00.000Z'),
    });
    expect(second.status('claude-code')).toMatchObject({
      status: 'disabled',
      capability: 'disabled',
    });
    expect(second.setDisabled('claude-code', false)).toMatchObject({
      status: 'active',
      capability: 'native',
    });
  });

  it('refuses to modify Codex until its hook format is verified', () => {
    const { manager, configPath } = makeManager({}, 'codex');
    const result = manager.install('codex');
    expect(result.status).toBe('degraded');
    expect(result.reason).toContain('not verified');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({});
  });
});
