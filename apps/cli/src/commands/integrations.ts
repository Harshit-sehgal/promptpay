import chalk from 'chalk';

import {
  HookConfigManager,
  IntegrationChangeResult,
  IntegrationProvider,
  IntegrationStatusResult,
} from '../lib/hook-config';

export type IntegrationCommandOptions = {
  provider?: string;
  /** Compute and print the install without touching the provider config. */
  dryRun?: boolean;
};

const PROVIDERS: IntegrationProvider[] = ['claude-code', 'codex'];

export function runIntegrationInstall(
  options: IntegrationCommandOptions,
): IntegrationChangeResult | null {
  const provider = parseProvider(options.provider);
  if (!provider) {
    process.exitCode = 1;
    return printInvalidProvider(options.provider);
  }
  const manager = new HookConfigManager();
  if (options.dryRun) {
    const planned = manager.plan(provider);
    printResult('Planned', planned);
    printDiff(planned.diff, planned.changed);
    setFailureExitCode(planned);
    return planned;
  }
  const result = manager.install(provider);
  printResult('Installed', result);
  setFailureExitCode(result);
  return result;
}

function printDiff(diff: string[], changed: boolean): void {
  if (!changed) {
    console.log(chalk.dim('  no changes — the Ateva hooks are already installed as configured'));
    return;
  }
  console.log(chalk.dim('  this would change the provider config as follows (nothing written):'));
  for (const line of diff) {
    if (line.startsWith('+ ')) console.log(chalk.green(`  ${line}`));
    else if (line.startsWith('- ')) console.log(chalk.red(`  ${line}`));
    else console.log(chalk.dim(`  ${line}`));
  }
  console.log(chalk.dim('  re-run without --dry-run to apply. A backup is written on change.'));
}

export function runIntegrationRepair(
  options: IntegrationCommandOptions,
): IntegrationChangeResult | null {
  const provider = parseProvider(options.provider);
  if (!provider) {
    process.exitCode = 1;
    return printInvalidProvider(options.provider);
  }
  const result = new HookConfigManager().repair(provider);
  printResult('Repaired', result);
  setFailureExitCode(result);
  return result;
}

export function runIntegrationDisable(
  options: IntegrationCommandOptions,
): IntegrationStatusResult | null {
  return setIntegrationDisabled(options, true);
}

export function runIntegrationEnable(
  options: IntegrationCommandOptions,
): IntegrationStatusResult | null {
  return setIntegrationDisabled(options, false);
}

function setIntegrationDisabled(
  options: IntegrationCommandOptions,
  disabled: boolean,
): IntegrationStatusResult | null {
  const provider = parseProvider(options.provider);
  if (!provider) {
    process.exitCode = 1;
    return printInvalidProvider(options.provider);
  }
  const result = new HookConfigManager().setDisabled(provider, disabled);
  printResult(disabled ? 'Disabled' : 'Enabled', result);
  setFailureExitCode(result);
  return result;
}

export function runIntegrationUninstall(
  options: IntegrationCommandOptions,
): IntegrationChangeResult | null {
  const provider = parseProvider(options.provider);
  if (!provider) {
    process.exitCode = 1;
    return printInvalidProvider(options.provider);
  }
  const result = new HookConfigManager().uninstall(provider);
  printResult('Uninstalled', result);
  setFailureExitCode(result);
  return result;
}

export function runIntegrationStatus(
  options: IntegrationCommandOptions = {},
): IntegrationStatusResult[] {
  const manager = new HookConfigManager();
  const providers = options.provider
    ? [parseProvider(options.provider)].filter(Boolean)
    : PROVIDERS;
  if (options.provider && providers.length === 0) {
    process.exitCode = 1;
    printInvalidProvider(options.provider);
    return [];
  }
  const results = providers.map((provider) => manager.status(provider as IntegrationProvider));
  const strict = Boolean(options.provider);
  for (const result of results) {
    printResult('Status', result);
    if (strict) setFailureExitCode(result);
  }
  return results;
}

function parseProvider(value: string | undefined): IntegrationProvider | null {
  if (value === 'claude-code' || value === 'claude_code' || value === 'claude')
    return 'claude-code';
  if (value === 'codex' || value === 'codex-cli' || value === 'codex_cli') return 'codex';
  return null;
}

function printInvalidProvider(value: string | undefined): null {
  console.error(
    chalk.red(`Unsupported integration${value ? `: ${value}` : ''}. Choose claude-code or codex.`),
  );
  return null;
}

function setFailureExitCode(result: IntegrationStatusResult): void {
  if (
    result.capability === 'degraded' ||
    result.capability === 'disabled' ||
    result.status === 'managed'
  ) {
    process.exitCode = 1;
  }
}

function printResult(action: string, result: IntegrationStatusResult): void {
  const color =
    result.status === 'active'
      ? chalk.green
      : result.status === 'not_installed'
        ? chalk.yellow
        : chalk.red;
  console.log(`${color(`✓ ${action}:`)} ${result.provider} — ${result.capability}`);
  console.log(chalk.dim(`  config: ${result.configPath}`));
  if (result.status !== result.capability) {
    console.log(chalk.dim(`  state: ${result.status}`));
  }
  if (result.reason) console.log(chalk.yellow(`  reason: ${result.reason}`));
  if (result.missingEvents.length > 0) {
    console.log(chalk.yellow(`  missing events: ${result.missingEvents.join(', ')}`));
  }
  if (result.backupPath) console.log(chalk.dim(`  backup: ${result.backupPath}`));
}
