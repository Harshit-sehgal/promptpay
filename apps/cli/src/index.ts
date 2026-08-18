#!/usr/bin/env node

import { Command } from 'commander';
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
// published artifact.
const packageRequire = createRequire(__filename);
const { version } = packageRequire('../package.json') as { version: string };

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
    '[WaitLayer] CLI is pointed at a local dev API (' +
      API_URL +
      '). Set WAITLAYER_API_URL to the production API (https://api.waitlayer.com/api/v1) to connect to WaitLayer.',
  );
}

const program = new Command();
program
  .name('waitlayer')
  .description('WaitLayer CLI — track AI wait states for the private beta')
  .version(version);

program
  .command('auth')
  .description('Authenticate with WaitLayer (login or signup)')
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
  .action((action: string | undefined, options) => runSandbox({ action, ...options }));

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
  .description('Repair a WaitLayer-owned native hook integration')
  .action((provider: string) => {
    runIntegrationRepair({ provider });
  });
integrationsCommand
  .command('uninstall <provider>')
  .description('Remove only WaitLayer-owned native hook entries')
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

program.parse();
