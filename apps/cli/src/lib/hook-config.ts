import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getCodexCapabilityStatus } from './codex-adapter';

export const HOOK_CONFIG_VERSION = 1;
export const WAITLAYER_HOOK_MARKER = 'waitlayer-managed-hook-v1';

export type IntegrationProvider = 'claude-code' | 'codex';

/** WL-043 ships Claude Code JSON merging; Codex remains deferred to WL-045. */
export const VERIFIED_INTEGRATION_PROVIDERS: IntegrationProvider[] = ['claude-code'];
type ConfigShape = Record<string, unknown>;

type HookCommand = {
  type: 'command';
  command: string;
};

type HookGroup = {
  matcher?: string;
  hooks: HookCommand[];
  [key: string]: unknown;
};

export type IntegrationStatus = 'not_installed' | 'active' | 'degraded' | 'disabled' | 'managed';

/** User-facing capability tier for integration health and fallback decisions. */
export type IntegrationCapability = 'native' | 'wrapper' | 'degraded' | 'disabled';

export type IntegrationStatusResult = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  capability: IntegrationCapability;
  configPath: string;
  installed: boolean;
  ownedEntries: number;
  expectedEvents: string[];
  missingEvents: string[];
  backupCount: number;
  reason?: string;
  backupPath?: string;
};

export type IntegrationChangeResult = IntegrationStatusResult & {
  changed: boolean;
  backupPath?: string;
};

export type HookConfigManagerOptions = {
  homeDir?: string;
  configPaths?: Partial<Record<IntegrationProvider, string>>;
  stateDir?: string;
  executable?: string;
  now?: () => Date;
};

const PROVIDER_CONFIG: Record<
  IntegrationProvider,
  { relativePath: string; events: string[]; protocolProvider: string }
> = {
  'claude-code': {
    relativePath: path.join('.claude', 'settings.json'),
    events: [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStart',
      'SubagentStop',
      'TaskCreated',
      'TaskCompleted',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ],
    protocolProvider: 'claude_code',
  },
  codex: {
    relativePath: path.join('.codex', 'config.json'),
    events: [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'SessionEnd',
    ],
    protocolProvider: 'codex_cli',
  },
};

/**
 * Manage only the WaitLayer-owned command entries in provider JSON settings.
 * Provider-specific event normalization remains in hook-ingestion/adapters;
 * this module deliberately treats the provider config as an opaque JSON tree
 * except for its top-level `hooks` object.
 */
export class HookConfigManager {
  private readonly homeDir: string;
  private readonly stateDir: string;
  private readonly executable: string;
  private readonly now: () => Date;
  private readonly configPaths: Record<IntegrationProvider, string>;

  constructor(options: HookConfigManagerOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.stateDir = options.stateDir ?? path.join(this.homeDir, '.config', 'waitlayer');
    this.executable = options.executable ?? resolveExecutable();
    this.now = options.now ?? (() => new Date());
    this.configPaths = {
      'claude-code':
        options.configPaths?.['claude-code'] ??
        path.join(this.homeDir, PROVIDER_CONFIG['claude-code'].relativePath),
      codex:
        options.configPaths?.codex ?? path.join(this.homeDir, PROVIDER_CONFIG.codex.relativePath),
    };
  }

  install(provider: IntegrationProvider): IntegrationChangeResult {
    if (provider === 'codex') return this.unsupportedResult(provider);
    const current = this.readConfig(provider);
    if (current.kind === 'invalid') return this.invalidResult(provider, current.reason);
    if (current.kind === 'missing') {
      // A missing config is safe to create, but still use the same atomic path
      // and protected permissions as an existing provider file.
      const config: ConfigShape = {};
      const next = mergeOwnedHooks(config, provider, this.executable);
      const backupPath = this.writeConfig(provider, next, undefined);
      this.persistState(provider, next);
      return this.result(provider, next, true, backupPath);
    }

    if (hasManagedLock(current.config)) {
      return this.invalidResult(
        provider,
        'provider configuration is managed or locked; edit it manually',
      );
    }

    const unsupportedShape = findUnsupportedHookShape(current.config, provider);
    if (unsupportedShape) return this.invalidResult(provider, unsupportedShape);
    const next = mergeOwnedHooks(current.config, provider, this.executable);
    const changed = JSON.stringify(current.config) !== JSON.stringify(next);
    const backupPath = changed ? this.writeConfig(provider, next, current.raw) : undefined;
    this.persistState(provider, next);
    return this.result(provider, next, changed, backupPath);
  }

  repair(provider: IntegrationProvider): IntegrationChangeResult {
    return this.install(provider);
  }

  setDisabled(provider: IntegrationProvider, disabled: boolean): IntegrationStatusResult {
    if (provider === 'codex') return this.unsupportedResult(provider);
    const current = this.readConfig(provider);
    if (current.kind === 'invalid') return this.invalidResult(provider, current.reason);
    const config = current.kind === 'valid' ? current.config : {};
    this.persistState(provider, config, disabled);
    return this.status(provider);
  }

  uninstall(provider: IntegrationProvider): IntegrationChangeResult {
    if (provider === 'codex') return this.unsupportedResult(provider);
    const current = this.readConfig(provider);
    if (current.kind === 'invalid') return this.invalidResult(provider, current.reason);
    if (current.kind === 'missing') return this.result(provider, {}, false);
    if (hasManagedLock(current.config)) {
      return this.invalidResult(
        provider,
        'provider configuration is managed or locked; edit it manually',
      );
    }

    const unsupportedShape = findUnsupportedHookShape(current.config, provider);
    if (unsupportedShape) return this.invalidResult(provider, unsupportedShape);
    const next = removeOwnedHooks(current.config, provider);
    const changed = JSON.stringify(current.config) !== JSON.stringify(next);
    const backupPath = changed ? this.writeConfig(provider, next, current.raw) : undefined;
    if (changed) this.clearState(provider);
    return this.result(provider, next, changed, backupPath);
  }

  status(provider: IntegrationProvider): IntegrationStatusResult {
    if (provider === 'codex') return this.unsupportedResult(provider);
    const current = this.readConfig(provider);
    if (current.kind === 'invalid') return this.invalidResult(provider, current.reason);
    if (current.kind === 'missing') return this.result(provider, {}, false);
    if (hasManagedLock(current.config)) {
      return this.invalidResult(
        provider,
        'provider configuration is managed or locked; edit it manually',
      );
    }
    const unsupportedShape = findUnsupportedHookShape(current.config, provider);
    if (unsupportedShape) return this.invalidResult(provider, unsupportedShape);
    return this.result(provider, current.config, false);
  }

  getConfigPath(provider: IntegrationProvider): string {
    return this.configPaths[provider];
  }

  isDisabled(provider: IntegrationProvider): boolean {
    return readState(this.statePath(provider))?.disabled === true;
  }

  private result(
    provider: IntegrationProvider,
    config: ConfigShape,
    changed: boolean,
    backupPath?: string,
  ): IntegrationChangeResult {
    const definition = providerDefinition(provider);
    const owned = ownedCommands(config, provider);
    const missingEvents = definition.events.filter((event) => !owned.has(event));
    let status: IntegrationStatus = 'not_installed';
    if (owned.size > 0 && missingEvents.length === 0) status = 'active';
    else if (owned.size > 0) status = 'degraded';
    const state = readState(this.statePath(provider));
    const stateDrifted = Boolean(state?.configHash && state.configHash !== hashConfig(config));
    if (state?.disabled === true) status = 'disabled';
    else if (stateDrifted) status = 'degraded';
    return {
      provider,
      status,
      capability: capabilityForStatus(status),
      configPath: this.configPaths[provider],
      installed: owned.size > 0,
      ownedEntries: owned.size,
      expectedEvents: [...definition.events],
      missingEvents,
      backupCount: countBackups(this.configPaths[provider]),
      ...(stateDrifted
        ? {
            reason:
              'provider configuration was manually modified; run repair to restore WaitLayer entries',
          }
        : {}),
      changed,
      ...(backupPath ? { backupPath } : {}),
    };
  }

  private unsupportedResult(provider: IntegrationProvider): IntegrationChangeResult {
    const definition = providerDefinition(provider);
    const capability = getCodexCapabilityStatus(this.configPaths[provider]);
    return {
      provider,
      status: 'degraded',
      capability: 'degraded',
      configPath: this.configPaths[provider],
      installed: false,
      ownedEntries: 0,
      expectedEvents: [...definition.events],
      missingEvents: [...definition.events],
      backupCount: countBackups(this.configPaths[provider]),
      changed: false,
      reason: capability.reason,
    };
  }

  private invalidResult(provider: IntegrationProvider, reason: string): IntegrationChangeResult {
    const definition = providerDefinition(provider);
    return {
      provider,
      status: reason.includes('managed') || reason.includes('locked') ? 'managed' : 'degraded',
      capability: 'degraded',
      configPath: this.configPaths[provider],
      installed: false,
      ownedEntries: 0,
      expectedEvents: [...definition.events],
      missingEvents: [...definition.events],
      backupCount: countBackups(this.configPaths[provider]),
      changed: false,
      reason,
    };
  }

  private readConfig(
    provider: IntegrationProvider,
  ):
    | { kind: 'missing' }
    | { kind: 'invalid'; reason: string }
    | { kind: 'valid'; config: ConfigShape; raw: string } {
    const file = this.configPaths[provider];
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error: unknown) {
      if (isFileError(error, 'ENOENT')) return { kind: 'missing' };
      return { kind: 'invalid', reason: 'cannot read provider configuration' };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || Array.isArray(parsed)) {
        return { kind: 'invalid', reason: 'provider configuration must be a JSON object' };
      }
      return { kind: 'valid', config: parsed, raw };
    } catch {
      return { kind: 'invalid', reason: 'provider configuration contains invalid JSON' };
    }
  }

  private writeConfig(
    provider: IntegrationProvider,
    config: ConfigShape,
    original?: string,
  ): string | undefined {
    const file = this.configPaths[provider];
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const backupPath =
      original === undefined ? undefined : createBackup(file, original, this.now());
    const temporary = `${file}.${process.pid}.${this.now().getTime()}.tmp`;
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    try {
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(temporary, 0o600);
      } catch {
        // Best effort on filesystems without POSIX permissions.
      }
      try {
        fs.renameSync(temporary, file);
      } catch (error: unknown) {
        // Never unlink a live provider configuration as a replacement
        // fallback: a process termination between unlink and rename could
        // lose the user's hooks. On platforms that cannot atomically replace
        // an existing file, fail closed; the protected backup remains
        // available and the original file is untouched.
        throw error;
      }
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Rename success or an earlier write failure may leave no temporary file.
      }
    }
    return backupPath;
  }

  private statePath(provider: IntegrationProvider): string {
    return path.join(this.stateDir, `integration-${provider}.json`);
  }

  private persistState(provider: IntegrationProvider, config: ConfigShape, disabled = false): void {
    fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const state = {
      version: HOOK_CONFIG_VERSION,
      provider,
      configPath: this.configPaths[provider],
      marker: WAITLAYER_HOOK_MARKER,
      configHash: hashConfig(config),
      ...(disabled ? { disabled: true } : {}),
      updatedAt: this.now().toISOString(),
    };
    const file = this.statePath(provider);
    const temporary = `${file}.${process.pid}.${this.now().getTime()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      try {
        fs.renameSync(temporary, file);
      } catch (error: unknown) {
        if (!isFileError(error, 'EEXIST') && !isFileError(error, 'EPERM')) throw error;
        try {
          fs.unlinkSync(file);
          fs.renameSync(temporary, file);
        } catch (replacementError: unknown) {
          throw replacementError;
        }
      }
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Best effort cleanup.
      }
    }
  }

  private clearState(provider: IntegrationProvider): void {
    try {
      fs.unlinkSync(this.statePath(provider));
    } catch {
      // State is advisory; the provider file is authoritative.
    }
  }
}

export function providerDefinition(provider: IntegrationProvider) {
  return PROVIDER_CONFIG[provider];
}

function findUnsupportedHookShape(
  config: ConfigShape,
  provider: IntegrationProvider,
): string | undefined {
  if (!isRecord(config.hooks)) return undefined;
  for (const event of providerDefinition(provider).events) {
    if (event in config.hooks && !Array.isArray(config.hooks[event])) {
      return `provider hook entry ${event} has an unsupported shape; no file was changed`;
    }
  }
  return undefined;
}

function mergeOwnedHooks(
  config: ConfigShape,
  provider: IntegrationProvider,
  executable: string,
): ConfigShape {
  const next = cloneRecord(config);
  const existingHooks = isRecord(next.hooks) ? cloneRecord(next.hooks) : {};
  const commandByEvent = new Map<string, unknown[]>();
  for (const event of providerDefinition(provider).events) {
    const existing = Array.isArray(existingHooks[event]) ? existingHooks[event] : [];
    const groups = existing.map((entry) =>
      isHookGroup(entry) ? { ...entry, hooks: [...entry.hooks] } : entry,
    );
    const command = hookCommand(provider, event, executable);
    const ownedIndex = groups.findIndex(
      (entry) =>
        isHookGroup(entry) && entry.hooks.some((hook) => isOwnedHook(hook, provider, event)),
    );
    if (ownedIndex >= 0) {
      const ownedGroup = groups[ownedIndex];
      if (isHookGroup(ownedGroup)) {
        groups[ownedIndex] = {
          ...ownedGroup,
          hooks: ownedGroup.hooks.map((hook) =>
            isOwnedHook(hook, provider, event) ? command : hook,
          ),
        };
      }
    } else {
      groups.push({ hooks: [command] });
    }
    commandByEvent.set(event, groups);
  }
  for (const [event, groups] of commandByEvent) existingHooks[event] = groups;
  next.hooks = existingHooks;
  return next;
}

function removeOwnedHooks(config: ConfigShape, provider: IntegrationProvider): ConfigShape {
  const next = cloneRecord(config);
  if (!isRecord(next.hooks)) return next;
  const hooks = cloneRecord(next.hooks);
  for (const [event, rawGroups] of Object.entries(hooks)) {
    if (!Array.isArray(rawGroups)) continue;
    const groups = rawGroups.flatMap((entry) => {
      if (!isHookGroup(entry)) return [entry];
      const remainingHooks = entry.hooks.filter((hook) => !isOwnedHook(hook, provider, event));
      return remainingHooks.length > 0 ? [{ ...entry, hooks: remainingHooks }] : [];
    });
    if (groups.length === 0) delete hooks[event];
    else hooks[event] = groups;
  }
  if (Object.keys(hooks).length === 0) delete next.hooks;
  else next.hooks = hooks;
  return next;
}

function hookCommand(
  provider: IntegrationProvider,
  event: string,
  executable: string,
): HookCommand {
  const protocolProvider = providerDefinition(provider).protocolProvider;
  return {
    type: 'command',
    command: `${shellQuote(executable)} hooks ingest --provider ${protocolProvider} --event ${shellQuote(event)} # ${WAITLAYER_HOOK_MARKER}`,
  };
}

function ownedCommands(config: ConfigShape, provider: IntegrationProvider): Set<string> {
  const owned = new Set<string>();
  if (!isRecord(config.hooks)) return owned;
  for (const [event, rawGroups] of Object.entries(config.hooks)) {
    if (!Array.isArray(rawGroups)) continue;
    for (const group of rawGroups) {
      if (!isHookGroup(group)) continue;
      if (group.hooks.some((hook) => isOwnedHook(hook, provider, event))) owned.add(event);
    }
  }
  return owned;
}

function isOwnedHook(hook: HookCommand, provider: IntegrationProvider, event: string): boolean {
  const protocolProvider = providerDefinition(provider).protocolProvider;
  // The executable path is intentionally variable across npm/global installs,
  // but the complete argument shape and terminal ownership marker must match.
  // This avoids treating an arbitrary command that merely mentions the marker
  // as a WaitLayer-owned hook.
  const escapedProvider = escapeRegExp(protocolProvider);
  const escapedEvent = escapeRegExp(event);
  return new RegExp(
    `^.+\\s+hooks\\s+ingest\\s+--provider\\s+${escapedProvider}\\s+--event\\s+'${escapedEvent}'\\s+#\\s+${escapeRegExp(WAITLAYER_HOOK_MARKER)}$`,
  ).test(hook.command.trim());
}

function isHookGroup(value: unknown): value is HookGroup {
  if (!isRecord(value) || !Array.isArray(value.hooks)) return false;
  return value.hooks.every(
    (hook) => isRecord(hook) && hook.type === 'command' && typeof hook.command === 'string',
  );
}

function hasManagedLock(config: ConfigShape): boolean {
  return config.managedBy === 'enterprise' || config.readOnly === true || config.locked === true;
}

function createBackup(file: string, contents: string, now: Date): string {
  const backup = `${file}.waitlayer-backup.${now.toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(backup, contents, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(backup, 0o600);
  } catch {
    // Best effort on filesystems without POSIX permissions.
  }
  return backup;
}

function countBackups(file: string): number {
  try {
    return fs
      .readdirSync(path.dirname(file))
      .filter((name) => name.startsWith(`${path.basename(file)}.waitlayer-backup.`)).length;
  } catch {
    return 0;
  }
}

function hashConfig(config: ConfigShape): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

function cloneRecord(value: ConfigShape): ConfigShape {
  return JSON.parse(JSON.stringify(value)) as ConfigShape;
}

function resolveExecutable(): string {
  return process.env.WAITLAYER_CLI_EXECUTABLE?.trim() || process.argv[1] || 'waitlayer';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
}

function isRecord(value: unknown): value is ConfigShape {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFileError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === code);
}

function capabilityForStatus(status: IntegrationStatus): IntegrationCapability {
  if (status === 'active') return 'native';
  if (status === 'disabled') return 'disabled';
  if (status === 'not_installed') return 'wrapper';
  return 'degraded';
}

function readState(file: string): { disabled?: boolean; configHash?: string } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
