#!/usr/bin/env node

import { Command } from 'commander';
import { realpathSync } from 'fs';
import { createRequire } from 'module';

import { runAuth } from './commands/auth';
import { runBridge } from './commands/bridge';
import { runConfig } from './commands/config';
import { runHookIngest } from './commands/hooks';
import {
  runIntegrationDisable,
  runIntegrationEnable,
  runIntegrationInstall,
  runIntegrationRepair,
  runIntegrationStatus,
  runIntegrationUninstall,
} from './commands/integrations';
import { runLogout } from './commands/logout';
import { runSupervisedCommand } from './commands/run';
import { runSandbox } from './commands/sandbox';
import { runStatus } from './commands/status';
import { runWatch } from './commands/watch';
import { resolveApiBaseUrl } from './lib/api-client';

// Read the version from package.json at runtime (dist/index.js sits beside the
// installed package.json) so the reported version can never drift from the
// published artifact. The catch keeps the module importable from ESM test
// runners where `__filename` does not exist; the version string is cosmetic.
function loadPackageVersion(): string {
  try {
    return (createRequire(__filename)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}
const version = loadPackageVersion();

const API_URL = resolveApiBaseUrl();
const API_HOSTNAME = (() => {
  try {
    return new URL(API_URL).hostname;
  } catch {
    return '';
  }
})();
const IS_LOOPBACK =
  API_HOSTNAME === 'localhost' || API_HOSTNAME === '127.0.0.1' || API_HOSTNAME === '::1';
if (IS_LOOPBACK) {
  console.warn(
    '[Ateva] CLI is pointed at a local dev API (' +
      API_URL +
      '). Set ATEVA_API_URL to the production API (https://ateva.vercel.app/api/v1) to connect to Ateva.',
  );
}

const program = new Command();
program
  .name('ateva')
  .description('Ateva CLI — track AI wait states for the private beta')
  .version(version);

program
  .command('auth')
  .description('Authenticate with Ateva (login or signup)')
  .option('-e, --email <email>', 'Login email')
  .option('-s, --signup', 'Create a new account instead of logging in')
  .action((opts) => runAuth(opts));

program
  .command('sandbox [action]')
  .description('Use test-only faucet, payout simulation, or status commands')
  .option('--idempotency-key <key>', 'Stable key for an idempotent sandbox operation')
  .option('--amount-minor <amount>', 'Sandbox payout amount in XTS minor units')
  .option('--destination <alias>', 'Sandbox payout destination, for example sandbox:demo')
  .option('--outcome <outcome>', 'Sandbox payout outcome')
  .action((action: string | undefined, options) =>
    runSandbox({ action, ...options, destinationAlias: options.destination }),
  );

program
  .command('status')
  .description('Show current earnings and wait state stats')
  .action(() => runStatus());

program
  .command('watch')
  .description('Run daemon that reports wait states in real time')
  .option('--once', 'Report existing wait state once and exit (test mode)')
  .option('--no-ads', 'Disable ad serving during wait states')
  .action((opts) => runWatch(opts));

program
  .command('run <command...>')
  .description('Supervise an AI command and record a real local wait lifecycle (beta)')
  .allowUnknownOption(true)
  .action(async (command: string[]) => {
    try {
      process.exitCode = await runSupervisedCommand(command);
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

const hooksCommand = program.command('hooks').description('Process provider lifecycle hooks');
hooksCommand
  .command('ingest')
  .description('Sanitize one provider lifecycle hook into the local event spool')
  .requiredOption('--provider <provider>', 'Provider identifier, for example claude_code')
  .requiredOption('--event <event>', 'Provider lifecycle event name')
  .action(async (options) => {
    await runHookIngest(options);
  });

const integrationsCommand = program
  .command('integrations')
  .description('Install, inspect, repair, or remove native provider integrations');
integrationsCommand
  .command('install <provider>')
  .description('Install a user-level native hook integration')
  .action((provider: string) => {
    runIntegrationInstall({ provider });
  });
integrationsCommand
  .command('status [provider]')
  .description('Show native integration health')
  .action((provider?: string) => {
    runIntegrationStatus({ provider });
  });
integrationsCommand
  .command('disable <provider>')
  .description('Disable lifecycle telemetry for a provider without removing hooks')
  .action((provider: string) => {
    runIntegrationDisable({ provider });
  });
integrationsCommand
  .command('enable <provider>')
  .description('Re-enable lifecycle telemetry for a provider')
  .action((provider: string) => {
    runIntegrationEnable({ provider });
  });
integrationsCommand
  .command('repair <provider>')
  .description('Repair a Ateva-owned native hook integration')
  .action((provider: string) => {
    runIntegrationRepair({ provider });
  });
integrationsCommand
  .command('uninstall <provider>')
  .description('Remove only Ateva-owned native hook entries')
  .action((provider: string) => {
    runIntegrationUninstall({ provider });
  });

program
  .command('bridge [action]')
  .description('Run, inspect, flush, or clear the local agent event bridge')
  .action((action?: string) => runBridge({ action }));

program
  .command('logout')
  .description('Remove stored credentials')
  .action(() => runLogout());

program
  .command('config')
  .description('View and update settings (ads, quiet mode, frequency)')
  .action(() => runConfig());

// Only parse when run as the CLI entrypoint (direct node invocation or the
// installed `ateva` bin symlink, both realpath-identical to this file).
// Tests import `program` to exercise the commander wiring hermetically; under
// an ESM test runner `__filename` is absent and the guard stays false.
let isEntrypoint = false;
try {
  isEntrypoint =
    typeof __filename !== 'undefined' &&
    Boolean(process.argv[1]) &&
    realpathSync(process.argv[1]) === realpathSync(__filename);
} catch {
  isEntrypoint = false;
}
if (isEntrypoint) {
  program.parse();
}

export { program };
