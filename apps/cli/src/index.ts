import { Command } from 'commander';

import { resolveApiBaseUrl } from './lib/api-client';
import { runAuth } from './commands/auth';
import { runConfig } from './commands/config';
import { runLogout } from './commands/logout';
import { runStatus } from './commands/status';
import { runWatch } from './commands/watch';

const API_URL = resolveApiBaseUrl();
const API_HOSTNAME = (() => {
  try {
    return new URL(API_URL).hostname;
  } catch {
    return '';
  }
})();
const IS_LOOPBACK = API_HOSTNAME === 'localhost' || API_HOSTNAME === '127.0.0.1' || API_HOSTNAME === '::1';
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
  .description('WaitLayer CLI — track AI wait states and earn rewards')
  .version('0.0.1');

program
  .command('auth')
  .description('Authenticate with WaitLayer (login or signup)')
  .option('-e, --email <email>', 'Login email')
  .option('-s, --signup', 'Create a new account instead of logging in')
  .action((opts) => runAuth(opts));

program
  .command('status')
  .description('Show current earnings and wait state stats')
  .option('--period <period>', 'Period: 1d | 7d | 30d', '7d')
  .action((opts) => runStatus(opts));

program
  .command('watch')
  .description('Run daemon that reports wait states in real time')
  .option('--once', 'Report existing wait state once and exit (test mode)')
  .action((opts) => runWatch(opts));

program
  .command('logout')
  .description('Remove stored credentials')
  .action(() => runLogout());

program
  .command('config')
  .description('View and update settings (ads, quiet mode, frequency)')
  .action(() => runConfig());

program.parse();
